import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Authentication gate. Runs on the Edge before any page renders, so an
// unauthenticated visitor never sees the dashboard flash
// before redirecting — they land straight on /login.
//
// Deliberately cheap: the session cookie gates page rendering; protected
// API routes independently validate its token against the database.
const SESSION_COOKIE_NAME = "pw_session";
const PUBLIC_PATHS = ["/login", "/signup"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (isPublic) {
    return NextResponse.next();
  }

  const isAuthed = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!isAuthed) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// API routes enforce authorization in their handlers. Exclude auth API
// routes from page redirects along with Next internals and static assets.
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.\\w+$).*)"],
};
