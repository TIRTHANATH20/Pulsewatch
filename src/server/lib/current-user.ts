import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { hashPassword, verifyPassword } from "@/server/lib/password";
import {
  DuplicateItemError,
  UnauthorizedError,
} from "@/server/modules/watchlist/errors";

const SESSION_COOKIE = "pw_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(token: string): void {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await prisma.authSession.create({
    data: { userId, tokenHash: hashSessionToken(token), expiresAt },
  });
  setSessionCookie(token);
}

export async function registerWithEmail(
  email: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const normalized = email.trim().toLowerCase();
  const passwordHash = await hashPassword(password);

  let user: Awaited<ReturnType<typeof prisma.user.create>>;
  try {
    user = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { email: normalized },
      });
      if (existing?.passwordHash) {
        throw new DuplicateItemError(
          "An account with this email already exists",
        );
      }
      if (existing) {
        return tx.user.update({
          where: { id: existing.id },
          data: { passwordHash },
        });
      }
      return tx.user.create({ data: { email: normalized, passwordHash } });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new DuplicateItemError("An account with this email already exists");
    }
    throw error;
  }

  await createSession(user.id);
  return { id: user.id, email: user.email };
}

export async function loginWithEmail(
  email: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (
    !user?.passwordHash ||
    !(await verifyPassword(password, user.passwordHash))
  ) {
    throw new UnauthorizedError("Email or password is incorrect");
  }

  await createSession(user.id);
  return { id: user.id, email: user.email };
}

export async function getCurrentUser(): Promise<{
  id: string;
  email: string;
} | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await prisma.authSession.delete({ where: { id: session.id } });
    return null;
  }
  return session.user;
}

export async function getAuthenticatedUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError("Please sign in to continue");
  return user.id;
}

export async function clearCurrentUserCookie(): Promise<void> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  cookieStore.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  cookieStore.set("pw_uid", "", { path: "/", maxAge: 0 });
  cookieStore.set("pw_authed", "", { path: "/", maxAge: 0 });
  if (!token) return;
  await prisma.authSession.deleteMany({
    where: { tokenHash: hashSessionToken(token) },
  });
}
