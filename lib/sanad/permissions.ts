import type { Role } from './integrated';

// UI capabilities mirror server authorization; the API remains authoritative.
export function permissionsFor(role: Role) {
  return {
    canEdit: role === 'admin' || role === 'reviewer' || role === 'officer',
    canApprove: role === 'admin' || role === 'reviewer',
  };
}
