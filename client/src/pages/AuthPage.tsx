import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Shield, Loader2, ArrowRight } from "lucide-react";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "register" | "verify" | "forgot" | "reset">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, register, verifyEmail, resendVerification, requestPasswordResetCode, confirmPasswordReset } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (mode === "login") {
        await login(username, password);
        toast({ title: "Welcome back!", description: "You are now logged in." });
      } else if (mode === "register") {
        const result = await register(username, email, password);
        if (result?.verification_email_sent) {
          toast({ title: "Account created", description: "Verification code sent to your email." });
        } else {
          toast({
            title: "Account created",
            description: "Email code was not delivered. Please check SMTP settings or try resend shortly.",
            variant: "destructive",
          });
        }
        setResendCooldown(result?.retry_after_seconds || 60);
        setMode("verify");
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
          <CardTitle className="text-2xl font-bold">
            <span className="text-primary">Trade</span> Aid
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
              </div>
            )}
            {(mode === "register" || mode === "verify" || mode === "forgot" || mode === "reset") && (
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
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-submit-auth">
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
