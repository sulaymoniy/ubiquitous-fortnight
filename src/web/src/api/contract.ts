// TEMP(contract): replace with @fortnight/shared after C-001 lands.
export interface MockUser {
  id: string;
  name: string;
  initials: string;
  color: string;
}
export interface SessionResponse {
  user: MockUser;
}
export interface LoginRequest {
  name: string;
  password?: string;
}
export interface HealthResponse {
  ok: true;
  contractVersion: string;
  agentKeyConfigured: boolean;
}
