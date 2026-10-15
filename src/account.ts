export type AccountStatus = 'pending' | 'active' | 'blocked' | 'rejected' | 'expired';
export interface Account {
  id: string; email: string; name: string; avatarUrl: string; emailVerified: boolean;
  role: 'admin' | 'member'; status: AccountStatus; profileComplete: boolean;
  contactName: string; phone: string; purpose: string;
  maxProfiles: number; maxConcurrent: number; liveEnabled: boolean; expiresAt: string | null;
  createdAt: string; lastLoginAt: string; lastSeenAt: string;
}
export interface ManagedAccount extends Account {
  profileCount: number; connectedCount: number; testRuns: number; liveRuns: number;
  adminNote: string; version: number;
}
export interface AccessGrant {
  email: string; maxProfiles: number; maxConcurrent: number; liveEnabled: boolean;
  expiresAt: string | null; createdAt: string;
}
export interface AdminEvent {
  id: string; at: string; actorEmail: string; targetEmail: string; action: string;
  details: Record<string, unknown>;
}
