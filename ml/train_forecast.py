"""Reproducible CBP count forecast; exact timestamp lags, <=24h direct horizon.

Public aggregate data only. No pickle files are loaded or shipped.
Model selection uses validation dates only; the final test is never used to tune.
"""
from pathlib import Path
import argparse
import hashlib
import json
import math
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'ml/data/cbp.parquet'
OUT = ROOT / 'lib/sanad/forecast-assets'
KEYS = ['airport', 'terminal']
TARGET = 'non_us_citizen_count'
TRAIN_END = pd.Timestamp('2026-08-12')
TEST_START = pd.Timestamp('2026-08-26')


def number(value):
    return None if not np.isfinite(value) else float(value)


def features(site, stamp, history, site_ids):
    """All count inputs are at t-24h or earlier, available for any <=24h origin.

    Missing hours remain missing. No row-offset lags, interpolation, or zero fill.
    Calendar fields use the airport's source local clock (not UTC).
    """
    hour, dow = stamp.hour, stamp.dayofweek
    previous = [history.get(stamp-pd.Timedelta(hours=h), np.nan) for h in (24,48,168)]
    daily = [history.get(stamp-pd.Timedelta(days=d), np.nan) for d in range(1,29)]
    seen = [v for v in daily if np.isfinite(v)]
    weekly = [daily[d-1] for d in (7,14,21,28) if np.isfinite(daily[d-1])]
    last_week = [v for v in daily[:7] if np.isfinite(v)]
    median = float(np.median(seen)) if seen else np.nan
    weekly_median = float(np.median(weekly)) if weekly else np.nan
    recent = float(np.mean(last_week)) if last_week else np.nan
    values = [hour, dow, float(dow>=5), math.sin(2*math.pi*hour/24),math.cos(2*math.pi*hour/24),
              math.sin(2*math.pi*dow/7),math.cos(2*math.pi*dow/7), *previous,
              median, weekly_median, recent, len(seen), len(weekly)]
    return values + [float(site==s) for s in site_ids]


def scores(actual, predicted):
    return {'rows':len(actual),'mae':float(mean_absolute_error(actual,predicted)),
            'rmse':float(mean_squared_error(actual,predicted)**.5)}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    raw = pd.read_parquet(DATA).sort_values(KEYS+['flight_date','hour_of_day'])
    raw['stamp']=pd.to_datetime(raw.flight_date)+pd.to_timedelta(raw.hour_of_day,unit='h')
    assert not raw.duplicated(KEYS+['stamp']).any()
    assert raw[TARGET].notna().all() and (raw[TARGET]>=0).all()
    site_ids = sorted({f'{a}|{t}' for a,t in raw[KEYS].itertuples(index=False,name=None)})
    histories,sites={},[]
    samples=[]
    for (airport,terminal),group in raw.groupby(KEYS):
        site=f'{airport}|{terminal}'
        history=dict(zip(group.stamp,group[TARGET].astype(float)))
        histories[site]=history
        seen_days=group.stamp.dt.normalize().nunique()
        available=len(group)>=48 and seen_days>=7
        sites.append({'id':site,'airport':airport,'terminal':terminal,'rows':len(group),
                      'days':int(seen_days),'first':str(group.stamp.min())[:16],
                      'last':str(group.stamp.max())[:16],'available':available,
                      'reason':None if available else 'insufficient_history',
                      'history':[[str(t)[:16],int(v)] for t,v in history.items()]})
        for row in group.itertuples():
            samples.append((site,row.stamp,float(getattr(row,TARGET)),features(site,row.stamp,history,site_ids)))
    samples.sort(key=lambda x:x[1])
    X=np.asarray([s[3] for s in samples],dtype=float)
    y=np.asarray([s[2] for s in samples])
    stamps=pd.DatetimeIndex([s[1] for s in samples])
    ids=np.asarray([s[0] for s in samples])
    train=stamps<TRAIN_END
    val=(stamps>=TRAIN_END)&(stamps<TEST_START)
    test=stamps>=TEST_START
    # Reference is learned only on the relevant training fold; uses site/hour median.
    def baselines(fit_mask):
        frame=pd.DataFrame({'site':ids[fit_mask],'hour':stamps[fit_mask].hour,'y':y[fit_mask]})
        hourly=frame.groupby(['site','hour']).y.median()
        site_prior=frame.groupby('site').y.median()
        global_prior=float(np.median(y[fit_mask]))
        values=np.array([hourly.get((s,t.hour),site_prior.get(s,global_prior)) for s,t,*_ in samples])
        history_median=X[:,10]
        weekly_median=X[:,11]
        historical=np.where(np.isfinite(history_median),history_median,values)
        weekly=np.where(np.isfinite(weekly_median),weekly_median,historical)
        return values,historical,weekly,hourly,site_prior,global_prior
    baseline,historical,weekly,*_=baselines(train)
    candidates={
        'calendar_baseline':baseline,
        'recent_same_hour':historical,
        'weekly_recent_blend':.4*weekly+.6*historical,
    }
    configs=[{'max_iter':180,'max_leaf_nodes':15,'learning_rate':.05,'l2_regularization':20},
             {'max_iter':250,'max_leaf_nodes':15,'learning_rate':.05,'l2_regularization':50},
             {'max_iter':180,'max_leaf_nodes':7,'learning_rate':.06,'l2_regularization':20}]
    trained={}
    # L1 loss matches the principal evaluation metric; predictable bounded trees.
    for i,config in enumerate(configs):
        model=HistGradientBoostingRegressor(loss='absolute_error',max_depth=5,min_samples_leaf=30,
                early_stopping=False,random_state=42,**config)
        model.fit(X[train],y[train])
        prediction=np.maximum(0,model.predict(X))
        trained[f'hgb_{i}']=(model,config)
        candidates[f'hgb_{i}']=prediction
        candidates[f'hgb_{i}_blend']=.75*prediction+.25*historical
        print('candidate',i,'validation',scores(y[val],prediction[val]),flush=True)
    validation={name:scores(y[val],p[val]) for name,p in candidates.items()}
    winner=min(validation,key=lambda name:validation[name]['mae'])
    print('selected',winner,flush=True)
    selected_val=candidates[winner][val]
    error_band=float(np.quantile(np.abs(y[val]-selected_val),.8))
    fit=~test
    baseline,historical,weekly,hourly,site_prior,global_prior=baselines(fit)
    selected_model=None
    if winner.startswith('hgb_'):
        model_name=winner.removesuffix('_blend')
        config=trained[model_name][1]
        selected_model=HistGradientBoostingRegressor(loss='absolute_error',max_depth=5,min_samples_leaf=30,
                  early_stopping=False,random_state=42,**config).fit(X[fit],y[fit])
        predicted=np.maximum(0,selected_model.predict(X))
        if winner.endswith('_blend'): predicted=.75*predicted+.25*historical
    elif winner=='recent_same_hour': predicted=historical
    elif winner=='weekly_recent_blend':predicted=.4*weekly+.6*historical
    else:predicted=baseline
    test_scores=scores(y[test],predicted[test])
    reference_scores=scores(y[test],baseline[test])
    forecast_dates=stamps[test]
    # Scores use only target hours actually published. Each input is >=24h old,
    # so predictions have the same information set at horizons 1 through 24.
    hourly_results=[]
    for site in site_ids:
        mask=test & (ids==site)
        if mask.sum(): hourly_results.append({'site':site,**scores(y[mask],predicted[mask])})
    metadata={'version':'2026-09-15.1','target':TARGET,'unit':'non-US passengers per local airport hour',
        'source':'https://huggingface.co/datasets/digitalhen/us-airport-wait-times',
        'upstream':'https://awt.cbp.gov/','license':'CC BY 4.0','author':'Henry Williams',
        'sourceSha256':hashlib.sha256(DATA.read_bytes()).hexdigest(),'rawRows':len(raw),'rawSites':len(sites),
        'airports':int(raw.airport.nunique()),'trainingEnd':str(TRAIN_END)[:10],
        'testStart':str(TEST_START)[:10],'testEnd':str(forecast_dates.max())[:16],
        'selected':winner,'validation':validation,'test':test_scores,'baseline':reference_scores,
        'improvementPercent':100*(reference_scores['mae']-test_scores['mae'])/reference_scores['mae'],
        'validationErrorBand80':error_band,
        'testBandCoverage':float((np.abs(y[test]-predicted[test])<=error_band).mean()),
        'trainingRows':int(fit.sum()),'selectionTrainRows':int(train.sum()),'validationRows':int(val.sum()),
        'lastObservation':str(raw.stamp.max())[:16],'firstObservation':str(raw.stamp.min())[:16],
        'mode':'historical_demo','timeBasis':'airport-local-naive','maxHorizon':24,
        'missingPolicy':'missing != zero; exact timestamp lags; missing branches and training-only fallback',
        'evaluation':'Final chronological test, only observed targets; each lag is >=24h old; no future observations used inside 24h forecasts. Source publication latency is not verified.',
        'sites':hourly_results}
    artifact={'metadata':metadata,'siteIds':site_ids,
        'baseline':{'global':global_prior,'site':dict(site_prior),
                    'hour':{f'{s}|{h}':float(v) for (s,h),v in hourly.items()}},
        'model':None}
    if selected_model is not None:
        trees=[]
        for stage in selected_model._predictors:
            nodes=stage[0].nodes
            assert not any(nodes['is_categorical'])
            trees.append([[int(n['is_leaf']),float(n['value']),int(n['feature_idx']),number(n['num_threshold']),
                           int(n['left']),int(n['right']),int(n['missing_go_to_left'])] for n in nodes])
        artifact['model']={'base':float(selected_model._baseline_prediction[0,0]),'trees':trees}
    # Final model intentionally remains pre-test fitted: reported quality and
    # the deployed model refer to the same artifact, not an unevaluated refit.
    (OUT/'model.json').write_text(json.dumps(artifact,separators=(',',':'),allow_nan=False),encoding='utf-8')
    (OUT/'history.json').write_text(json.dumps({'sites':sites},separators=(',',':')),encoding='utf-8')
    test_indices=np.where(test)[0]
    chosen=test_indices[np.linspace(0,len(test_indices)-1,40,dtype=int)]
    fixtures=[{'site':samples[i][0],'time':str(samples[i][1])[:16],'features':[number(v) for v in X[i]],
               'expected':float(predicted[i])} for i in chosen]
    (ROOT/'ml/fixtures.json').write_text(json.dumps(fixtures,indent=2,allow_nan=False),encoding='utf-8')
    (ROOT/'ml/evaluation.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    print(json.dumps({'selected':winner,'test':test_scores,'baseline':reference_scores,
                      'modelBytes':(OUT/'model.json').stat().st_size,'historyBytes':(OUT/'history.json').stat().st_size}),flush=True)


if __name__=='__main__':
    main()
