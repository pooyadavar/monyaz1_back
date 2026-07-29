const crypto = require("crypto");

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const base64url = (input) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const base64urlJson = (value) => base64url(JSON.stringify(value));

const decodeBase64url = (value) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
};

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === "change_me") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET must be set in production");
    }
    return "dev_only_change_me";
  }
  return secret;
};

const timingSafeEqualText = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
};

const verifyPassword = (password, storedHash) => {
  const [scheme, salt, hash] = String(storedHash || "").split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return timingSafeEqualText(candidate, hash);
};

const signToken = (payload) => {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const body = {
    ...payload,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const unsigned = `${base64urlJson(header)}.${base64urlJson(body)}`;
  const signature = crypto
    .createHmac("sha256", getJwtSecret())
    .update(unsigned)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${unsigned}.${signature}`;
};

const verifyToken = (token) => {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const unsigned = `${header}.${payload}`;
  const expected = crypto
    .createHmac("sha256", getJwtSecret())
    .update(unsigned)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  if (!timingSafeEqualText(signature, expected)) return null;

  try {
    const parsed = JSON.parse(decodeBase64url(payload));
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
};

module.exports = {
  hashPassword,
  signToken,
  verifyPassword,
  verifyToken,
};
