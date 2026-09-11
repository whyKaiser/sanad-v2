/** Immutable document bytes, split below D1's 2 MB row limit. */
export function documentStore(database:D1Database){
  return {
    async put(key:string,bytes:Uint8Array,options:{httpMetadata:{contentType:string}}){
      const statements=[database.prepare("INSERT INTO stored_objects (id,content_type,size,created_at) VALUES (?,?,?,?)").bind(key,options.httpMetadata.contentType,bytes.length,new Date().toISOString())];
      for(let offset=0,index=0;offset<bytes.length;offset+=256*1024,index++)statements.push(database.prepare("INSERT INTO object_chunks (object_id,chunk_index,data) VALUES (?,?,?)").bind(key,index,bytes.slice(offset,offset+256*1024).buffer));
      await database.batch(statements);
    },
    async get(key:string){
      const object=await database.prepare("SELECT size,content_type FROM stored_objects WHERE id=?").bind(key).first<{size:number;content_type:string}>();if(!object)return null;
      const chunks=await database.prepare("SELECT data FROM object_chunks WHERE object_id=? ORDER BY chunk_index").bind(key).all<{data:number[]|ArrayBuffer}>();
      const result=new Uint8Array(object.size);let offset=0;
      for(const row of chunks.results){const chunk=new Uint8Array(row.data);result.set(chunk,offset);offset+=chunk.length;}
      if(offset!==object.size)throw new Error("Incomplete document bytes");
      return {body:result.buffer,contentType:object.content_type};
    },
    async delete(key:string){await database.prepare("DELETE FROM stored_objects WHERE id=?").bind(key).run();},
  };
}
