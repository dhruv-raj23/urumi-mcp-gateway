import { ObjectId, type Collection } from "mongodb";

import type { UserDocument } from "../db/models.js";
import { hashPassword } from "./passwords.js";

/**
 * Creates the initial admin only when the users collection is empty.
 *
 * Existing users are never modified or reset by this bootstrap process.
 */
export async function ensureBootstrapAdmin(
  users: Collection<UserDocument>,
  emailValue = process.env.BOOTSTRAP_ADMIN_EMAIL,
  passwordValue = process.env.BOOTSTRAP_ADMIN_PASSWORD,
): Promise<"created" | "already-initialized"> {
  const existingCount = await users.countDocuments({}, { limit: 1 });

  if (existingCount > 0) {
    return "already-initialized";
  }

  const email = emailValue?.trim().toLowerCase();

  if (!email || !passwordValue) {
    throw new Error(
      "Bootstrap admin credentials are required when no users exist",
    );
  }

  const passwordHash = await hashPassword(passwordValue);

  await users.insertOne({
    _id: new ObjectId(),
    email,
    passwordHash,
    role: "admin",
    status: "active",
    createdAt: new Date(),
  });

  return "created";
}
