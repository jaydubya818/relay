import { redirect } from "next/navigation";
import { currentUser, signupEnabled } from "@/lib/auth";
import { BetaSignup } from "@/components/beta-signup";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await currentUser()) redirect("/");
  return <BetaSignup publicSignupEnabled={signupEnabled()} />;
}
