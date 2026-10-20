import type { Document, ObjectId } from "mongodb";

export type UserRole = "admin" | "member";
export type UserStatus = "invited" | "active" | "disabled";

export type ServerStatus = "connected" | "unreachable" | "disabled";
export type AuditSource = "mcp" | "chat";
export type AuditOutcome = "success" | "error" | "timeout" | "denied";

export interface UserDocument extends Document {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  inviteTokenHash?: string;
  inviteExpiresAt?: Date;
  createdAt: Date;
}

export interface ApiKeyDocument extends Document {
  _id: ObjectId;
  userId: ObjectId;
  name: string;
  prefix: string;
  hash: string;
  createdAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
}

export interface ServerDocument extends Document {
  _id: ObjectId;
  slug: string;
  name: string;
  url: string;
  authType: string;
  headerName?: string;
  credentialEnc?: string;
  enabled: boolean;
  status: ServerStatus;
  statusReason?: string;
  lastCheckedAt?: Date;
  createdAt: Date;
}

export interface AuditLogDocument extends Document {
  _id: ObjectId;
  ts: Date;
  userId: ObjectId;
  userEmail: string;
  source: AuditSource;
  serverSlug: string;
  toolName: string;
  durationMs: number;
  outcome: AuditOutcome;
  errorMessage?: string;
  argsHash: string;
}
