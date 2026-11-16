import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const soilOwnerCookieName = "loam_soil_owner";

function secret() {
  const value = process.env.SOIL_OWNER_COOKIE_SECRET?.trim();
  if (!value || value.length < 32) throw new Error("SOIL_OWNER_COOKIE_SECRET must contain at least 32 random characters.");
  return value;
}

function signature(ownerId: string) {
  return createHmac("sha256", secret()).update(ownerId).digest("base64url");
}

export function parseSoilOwnerCookie(cookieHeader: string | null): string | null {
  const prefix = soilOwnerCookieName + "=";
  const value = cookieHeader?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length);
  if (!value) return null;
  const [ownerId, suppliedSignature] = decodeURIComponent(value).split(".");
  if (!ownerId || !suppliedSignature || !/^[0-9a-f-]{36}$/i.test(ownerId)) return null;
  const expected = Buffer.from(signature(ownerId));
  const supplied = Buffer.from(suppliedSignature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied) ? ownerId : null;
}

export function getOrCreateSoilOwner(request: Request) {
  const existing = parseSoilOwnerCookie(request.headers.get("cookie"));
  const ownerId = existing ?? randomUUID();
  const cookieValue = encodeURIComponent(ownerId + "." + signature(ownerId));
  return {
    ownerIdHash: createHash("sha256").update(ownerId).digest("hex"),
    setCookie: existing ? null : soilOwnerCookieName + "=" + cookieValue + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000" + (process.env.NODE_ENV === "production" ? "; Secure" : ""),
  };
}
