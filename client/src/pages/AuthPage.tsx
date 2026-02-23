import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TradeAidLogo } from "@/components/brand/TradeAidLogo";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Shield, Loader2, ArrowRight, Chrome, Apple, Bot, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";

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
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetConfirmPassword, setResetConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "valid" | "invalid" | "taken">("idle");
  const [usernameMessage, setUsernameMessage] = useState("");
  const { login, consumeOAuthTokens, register, checkUsername, verifyEmail, resendVerification, requestPasswordResetCode, confirmPasswordReset } = useAuth();
  const { toast } = useToast();
  const registerPasswordErrors = getPasswordErrors(password);
  const resetPasswordErrors = getPasswordErrors(newPassword);
  const registerPasswordsMismatch = mode === "register" && !!registerConfirmPassword && password !== registerConfirmPassword;
  const resetPasswordsMismatch = mode === "reset" && !!resetConfirmPassword && newPassword !== resetConfirmPassword;
  const emailInvalid = !!email && !EMAIL_PATTERN.test(email);
  const usernameInvalid = mode === "register" && !!username && !USERNAME_PATTERN.test(username.trim());

  const isSubmitDisabled =
    isSubmitting ||
    (mode === "login" && (!username.trim() || !password || !accessCode.trim())) ||
    (mode === "register" && (!username.trim() || !accessCode.trim() || usernameInvalid || usernameStatus === "checking" || usernameStatus === "taken" || registerPasswordErrors.length > 0 || !registerConfirmPassword || registerPasswordsMismatch)) ||
    (mode === "verify" && (emailInvalid || code.trim().length < 6)) ||
    (mode === "forgot" && emailInvalid) ||
    (mode === "reset" && (emailInvalid || code.trim().length < 6 || resetPasswordErrors.length > 0 || !resetConfirmPassword || resetPasswordsMismatch));

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
    setUsernameMessage("");
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
        setUsernameMessage("");
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
      toast({ title: "Authentication issue", description: oauthError, variant: "destructive" });
      clearParams();
      return;
    }

    consumeOAuthTokens(oauthAccessToken, oauthRefreshToken)
      .then(() => {
        toast({ title: "Signed in", description: "You're securely signed in." });
      })
      .catch((error) => {
        toast({
          title: "Sign-in unsuccessful",
          description: error instanceof Error ? error.message : "We couldn't complete your OAuth sign-in.",
          variant: "destructive",
        });
      })
      .finally(clearParams);
  }, [consumeOAuthTokens, toast]);

  const startOAuthSignIn = (provider: "google" | "apple") => {
    const apiBase = (import.meta.env.VITE_API_URL || "").trim();
    if (!apiBase) {
      toast({ title: "Configuration required", description: "OAuth sign-in is unavailable. Missing VITE_API_URL.", variant: "destructive" });
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
        throw new Error("Please enter a valid email address.");
      }

      if (mode === "register" && registerPasswordErrors.length > 0) {
        throw new Error("Your password must include an uppercase letter, a number, a special character, and be at least 6 characters.");
      }

      if (mode === "register" && password !== registerConfirmPassword) {
        throw new Error("Password and confirm password must match.");
      }

      if (mode === "reset" && resetPasswordErrors.length > 0) {
        throw new Error("Your new password must include an uppercase letter, a number, a special character, and be at least 6 characters.");
      }

      if (mode === "reset" && newPassword !== resetConfirmPassword) {
        throw new Error("New password and confirm password must match.");
      }

      if (mode === "login") {
        await login(username, password, accessCode);
        toast({ title: "Welcome back", description: "You're signed in and ready to trade." });
      } else if (mode === "register") {
        const result = await register(username, undefined, password, accessCode);
        if (result?.verification_email_sent) {
          toast({ title: "Account created", description: "Your account is ready. A verification code has been sent to your email." });
        } else {
          toast({
            title: "Account created",
            description: "Your account is active. Please sign in to continue.",
          });
        }
        setResendCooldown(result?.retry_after_seconds || 60);
        setMode("login");
      } else if (mode === "verify") {
        await verifyEmail(email, code);
        toast({ title: "Email verified", description: "Verification completed. You can now sign in." });
        setMode("login");
      } else if (mode === "forgot") {
        await requestPasswordResetCode(email);
        toast({ title: "Reset code sent", description: "A password reset code has been sent to your email." });
        setMode("reset");
      } else if (mode === "reset") {
        await confirmPasswordReset(email, code, newPassword);
        toast({ title: "Password updated", description: "Your password has been updated. Sign in with your new credentials." });
        setMode("login");
        setPassword("");
        setNewPassword("");
        setCode("");
      }
    } catch (err: any) {
      const rawMessage = String(err?.message || "").trim();
      const normalized = rawMessage.toLowerCase();
      const friendlyMessage =
        mode === "register" && (normalized.includes("network") || normalized.includes("load failed") || normalized.includes("failed to fetch"))
          ? "We couldn't create your account right now. Please check your connection and try again."
          : rawMessage || "We couldn't complete your request. Please try again.";

      toast({
        title: "Request failed",
        description: friendlyMessage,
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
      <motion.div
        className="w-full max-w-md relative z-10 [perspective:1400px]"
        initial={{ opacity: 0, y: 16, rotateX: 5 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        whileHover={{ rotateX: -2, rotateY: 2, y: -2, scale: 1.005 }}
      >
      <Card className="w-full border-primary/20 shadow-2xl backdrop-blur-xl bg-card/85 will-change-transform">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center mb-2 animate-pulse">
            <Shield className="w-7 h-7 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold flex items-center justify-center">
            <TradeAidLogo withText className="scale-95" />
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            {mode === "login" && "Sign in to access your trading workspace"}
            {mode === "register" && "Create your account to unlock TradeAid"}
            {mode === "verify" && "Enter the verification code sent to your email"}
            {mode === "forgot" && "Request a secure password reset code"}
            {mode === "reset" && "Set a new password to secure your account"}
          </p>

          <div className="rounded-xl border border-primary/25 bg-gradient-to-r from-accent/10 to-primary/10 px-3 py-2 flex items-center justify-between gap-3">
            <div className="text-left">
              <p className="text-sm doctorstrange-font text-gradient">DoctorStrange is available</p>
              <p className="text-[11px] text-muted-foreground">Sign in to unlock AI trading intelligence.</p>
            </div>
            <Bot className="w-5 h-5 text-primary doctorstrange-sigil" />
          </div>
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
                {mode === "register" && usernameMessage && (usernameStatus === "invalid" || usernameStatus === "taken") && (
                  <p className="text-xs text-destructive">
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
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  data-testid="input-password"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowPassword((value) => !value)}
                  data-testid="button-toggle-password-visibility"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {mode === "register" && registerPasswordErrors.length > 0 && (
                <p className="text-xs text-destructive">Password rules: {registerPasswordErrors.join(", ")}</p>
              )}
              </div>
            )}
            {mode === "register" && (
              <div className="space-y-2">
                <Label htmlFor="register-confirm-password">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="register-confirm-password"
                    type={showRegisterConfirmPassword ? "text" : "password"}
                    placeholder="Confirm your password"
                    value={registerConfirmPassword}
                    onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                    required
                    data-testid="input-register-confirm-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowRegisterConfirmPassword((value) => !value)}
                    data-testid="button-toggle-register-confirm-password-visibility"
                  >
                    {showRegisterConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {registerPasswordsMismatch && (
                  <p className="text-xs text-destructive">Confirm password must match your password.</p>
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
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showNewPassword ? "text" : "password"}
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    data-testid="input-new-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowNewPassword((value) => !value)}
                    data-testid="button-toggle-new-password-visibility"
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {resetPasswordErrors.length > 0 && (
                  <p className="text-xs text-destructive">Password rules: {resetPasswordErrors.join(", ")}</p>
                )}
              </div>
            )}
            {mode === "reset" && (
              <div className="space-y-2">
                <Label htmlFor="reset-confirm-password">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="reset-confirm-password"
                    type={showResetConfirmPassword ? "text" : "password"}
                    placeholder="Confirm new password"
                    value={resetConfirmPassword}
                    onChange={(e) => setResetConfirmPassword(e.target.value)}
                    required
                    data-testid="input-reset-confirm-password"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowResetConfirmPassword((value) => !value)}
                    data-testid="button-toggle-reset-confirm-password-visibility"
                  >
                    {showResetConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {resetPasswordsMismatch && (
                  <p className="text-xs text-destructive">Confirm password must match your new password.</p>
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
                    toast({ title: "Verification code sent", description: "A new verification code has been delivered to your email." });
                  } else {
                    toast({
                      title: "Request limit reached",
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
      </motion.div>
    </div>
  );
}
