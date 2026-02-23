import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TradeAidLogo } from "@/components/brand/TradeAidLogo";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Shield, Loader2, ArrowRight, Chrome, Apple } from "lucide-react";

const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const SPECIAL_PATTERN = /[^A-Za-z0-9]/;
const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;

function getPasswordErrors(value: string): string[] {
  const errors: string[] = [];
  if (value.length < 6) errors.push("At least 6 characters");
  if (!/[A-Z]/.test(value)) errors.push("At least 1 uppercase letter");
  if (!/[0-9]/.test(value)) errors.push("At least 1 number");
  if (!SPECIAL_PATTERN.test(value)) errors.push("At least 1 special character");
  return errors;
}

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "register" | "verify" | "forgot" | "reset">("login");
  const [username, setUsername] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "valid" | "invalid" | "taken">("idle");
  const [usernameMessage, setUsernameMessage] = useState("");
  const { login, consumeOAuthTokens, register, checkUsername, verifyEmail, resendVerification, requestPasswordResetCode, confirmPasswordReset } = useAuth();
  const { toast } = useToast();
  const registerPasswordErrors = getPasswordErrors(password);
  const resetPasswordErrors = getPasswordErrors(newPassword);
  const emailInvalid = !!email && !EMAIL_PATTERN.test(email);
  const usernameInvalid = mode === "register" && !!username && !USERNAME_PATTERN.test(username.trim());

  const isSubmitDisabled =
    isSubmitting ||
    (mode === "login" && (!username.trim() || !password || !accessCode.trim())) ||
    (mode === "register" && (!username.trim() || !accessCode.trim() || usernameInvalid || usernameStatus !== "valid" || registerPasswordErrors.length > 0)) ||
    (mode === "verify" && (emailInvalid || code.trim().length < 6)) ||
    (mode === "forgot" && emailInvalid) ||
    (mode === "reset" && (emailInvalid || code.trim().length < 6 || resetPasswordErrors.length > 0));

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (mode !== "register") {
      setUsernameStatus("idle");
      setUsernameMessage("");
      return;
    }

    const value = username.trim();
    if (!value) {
      setUsernameStatus("idle");
      setUsernameMessage("");
      return;
    }

    if (!USERNAME_PATTERN.test(value)) {
      setUsernameStatus("invalid");
      setUsernameMessage("Username must be 3-20 chars, start with a letter, and use only letters, numbers, or underscore.");
      return;
    }

    setUsernameStatus("checking");
    setUsernameMessage("Checking username availability...");
    const timer = setTimeout(async () => {
      try {
        const result = await checkUsername(value);
        if (!result.valid) {
          setUsernameStatus("invalid");
          setUsernameMessage(result.message);
          return;
        }
        if (!result.available) {
          setUsernameStatus("taken");
          setUsernameMessage(result.message);
          return;
        }
        setUsernameStatus("valid");
        setUsernameMessage(result.message);
      } catch {
        setUsernameStatus("idle");
        setUsernameMessage("");
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [mode, username, checkUsername]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthAccessToken = params.get("oauth_access_token");
    const oauthRefreshToken = params.get("oauth_refresh_token") || undefined;
    const oauthError = params.get("oauth_error");

    if (!oauthAccessToken && !oauthError) return;

    const clearParams = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("oauth_access_token");
      url.searchParams.delete("oauth_refresh_token");
      url.searchParams.delete("oauth_success");
      url.searchParams.delete("oauth_error");
      window.history.replaceState({}, "", url.toString());
    };

    if (oauthError) {
      toast({ title: "OAuth error", description: oauthError, variant: "destructive" });
      clearParams();
      return;
    }

    consumeOAuthTokens(oauthAccessToken, oauthRefreshToken)
      .then(() => {
        toast({ title: "Welcome", description: "Signed in successfully." });
      })
      .catch((error) => {
        toast({
          title: "OAuth sign-in failed",
          description: error instanceof Error ? error.message : "Could not complete OAuth sign-in.",
          variant: "destructive",
        });
      })
      .finally(clearParams);
  }, [consumeOAuthTokens, toast]);

  const startOAuthSignIn = (provider: "google" | "apple") => {
    const apiBase = (import.meta.env.VITE_API_URL || "").trim();
    if (!apiBase) {
      toast({ title: "OAuth not configured", description: "Missing VITE_API_URL for OAuth redirect.", variant: "destructive" });
      return;
    }
    const frontendRedirect = `${window.location.origin}/`;
    const startUrl = `${apiBase}/api/auth/oauth/${provider}/start?redirect_uri=${encodeURIComponent(frontendRedirect)}`;
    window.location.assign(startUrl);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if ((mode === "verify" || mode === "forgot" || mode === "reset") && !EMAIL_PATTERN.test(email)) {
        throw new Error("Enter a valid email address");
      }

      if (mode === "register" && registerPasswordErrors.length > 0) {
        throw new Error("Password must include uppercase, number, special character, and be at least 6 characters");
      }

      if (mode === "reset" && resetPasswordErrors.length > 0) {
        throw new Error("New password must include uppercase, number, special character, and be at least 6 characters");
      }

      if (mode === "login") {
        await login(username, password, accessCode);
        toast({ title: "Welcome back!", description: "You are now logged in." });
      } else if (mode === "register") {
        const result = await register(username, undefined, password, accessCode);
        if (result?.verification_email_sent) {
          toast({ title: "Account created", description: "Verification code sent to your email." });
        } else {
          toast({
            title: "Account created",
            description: "Your account is ready. You can sign in now.",
          });
        }
        setResendCooldown(result?.retry_after_seconds || 60);
        setMode("login");
      } else if (mode === "verify") {
        await verifyEmail(email, code);
        toast({ title: "Email verified", description: "You can now sign in." });
        setMode("login");
      } else if (mode === "forgot") {
        await requestPasswordResetCode(email);
        toast({ title: "Reset code sent", description: "Check your email for the password reset code." });
        setMode("reset");
      } else if (mode === "reset") {
        await confirmPasswordReset(email, code, newPassword);
        toast({ title: "Password updated", description: "You can now login with your new password." });
        setMode("login");
        setPassword("");
        setNewPassword("");
        setCode("");
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute -top-20 -left-10 w-80 h-80 rounded-full bg-primary/20 blur-3xl animate-pulse pointer-events-none" />
      <div className="absolute -bottom-24 -right-12 w-80 h-80 rounded-full bg-accent/20 blur-3xl animate-pulse pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(153,69,255,0.15),transparent_45%)] pointer-events-none" />
      <Card className="w-full max-w-md relative z-10 border-primary/20 shadow-2xl backdrop-blur-xl bg-card/85">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-2 animate-pulse">
            <Shield className="w-7 h-7 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold flex items-center justify-center">
            <TradeAidLogo withText className="scale-95" />
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            {mode === "login" && "Sign in to your trading dashboard"}
            {mode === "register" && "Create your account and verify email"}
            {mode === "verify" && "Enter the verification code sent to your email"}
            {mode === "forgot" && "Request a password reset code"}
            {mode === "reset" && "Enter code and set a new password"}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {(mode === "login" || mode === "register") && (
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  data-testid="input-username"
                />
                {mode === "register" && usernameMessage && (
                  <p className={`text-xs ${usernameStatus === "valid" ? "text-green-600" : usernameStatus === "checking" ? "text-muted-foreground" : "text-destructive"}`}>
                    {usernameMessage}
                  </p>
                )}
              </div>
            )}
            {(mode === "login" || mode === "register") && (
              <div className="space-y-2">
                <Label htmlFor="access-code">Access Code</Label>
                <Input
                  id="access-code"
                  placeholder="Enter access code"
                  value={accessCode}
                  onChange={(e) => setAccessCode(e.target.value)}
                  required
                  data-testid="input-access-code"
                />
              </div>
            )}
            {(mode === "verify" || mode === "forgot" || mode === "reset") && (
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  data-testid="input-email"
                />
                {emailInvalid && <p className="text-xs text-destructive">Enter a valid email format (example@domain.com)</p>}
              </div>
            )}
            {(mode === "login" || mode === "register") && (
              <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="input-password"
              />
              {mode === "register" && registerPasswordErrors.length > 0 && (
                <p className="text-xs text-destructive">Password rules: {registerPasswordErrors.join(", ")}</p>
              )}
              </div>
            )}
            {(mode === "verify" || mode === "reset") && (
              <div className="space-y-2">
                <Label htmlFor="code">Email Code</Label>
                <Input
                  id="code"
                  placeholder="6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  data-testid="input-code"
                />
              </div>
            )}
            {mode === "reset" && (
              <div className="space-y-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  data-testid="input-new-password"
                />
                {resetPasswordErrors.length > 0 && (
                  <p className="text-xs text-destructive">Password rules: {resetPasswordErrors.join(", ")}</p>
                )}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitDisabled} data-testid="button-submit-auth">
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  {mode === "login" && "Sign In"}
                  {mode === "register" && "Create Account"}
                  {mode === "verify" && "Verify Email"}
                  {mode === "forgot" && "Send Reset Code"}
                  {mode === "reset" && "Reset Password"}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>

            {(mode === "login" || mode === "register") && (
              <>
                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">or continue with</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => startOAuthSignIn("google")}
                    data-testid="button-google-signin"
                  >
                    <Chrome className="w-4 h-4 mr-2" />
                    Google
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => startOAuthSignIn("apple")}
                    data-testid="button-apple-signin"
                  >
                    <Apple className="w-4 h-4 mr-2" />
                    Apple ID
                  </Button>
                </div>
              </>
            )}

            {mode === "verify" && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={resendCooldown > 0}
                onClick={async () => {
                  const response = await resendVerification(email);
                  if (response?.sent) {
                    toast({ title: "Code resent", description: "A new verification code was sent." });
                  } else {
                    toast({
                      title: "Please wait",
                      description: `You can request a new code in ${response?.retry_after_seconds || 60}s.`,
                      variant: "destructive",
                    });
                  }
                  setResendCooldown(response?.retry_after_seconds || 60);
                }}
                data-testid="button-resend-code"
              >
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend Code"}
              </Button>
            )}
          </form>
          <div className="mt-6 text-center text-sm">
            {mode === "login" ? (
              <p className="text-muted-foreground">
                Don't have an account?{" "}
                <button
                  onClick={() => setMode("register")}
                  className="text-primary font-medium"
                  data-testid="button-switch-register"
                >
                  Sign up
                </button>
              </p>
            ) : mode === "register" ? (
              <p className="text-muted-foreground">
                Already have an account?{" "}
                <button
                  onClick={() => setMode("login")}
                  className="text-primary font-medium"
                  data-testid="button-switch-login"
                >
                  Sign in
                </button>
              </p>
            ) : mode === "forgot" ? (
              <p className="text-muted-foreground">
                Remembered your password?{" "}
                <button onClick={() => setMode("login")} className="text-primary font-medium">Sign in</button>
              </p>
            ) : (
              <p className="text-muted-foreground">
                Back to{" "}
                <button onClick={() => setMode("login")} className="text-primary font-medium">Sign in</button>
              </p>
            )}

            {mode === "login" && (
              <button
                onClick={() => setMode("forgot")}
                className="text-xs text-primary font-medium mt-3"
                data-testid="button-forgot-password"
              >
                Forgot password?
              </button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
