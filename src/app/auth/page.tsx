import AuthForm from "./AuthForm";

// Always render fresh — this page must never be served from a stale edge
// cache (a code change here should show up immediately, not after a
// multi-minute stale-while-revalidate window).
export const dynamic = "force-dynamic";

export default function Auth() {
  return <AuthForm />;
}
