import { useAuth } from "@/hooks/use-auth";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import { User, Shield, LogOut, Activity, TrendingUp, Camera, Save } from "lucide-react";
import { useChain, SUPPORTED_CHAINS } from "@/hooks/use-chain";
import {
  useApproveAssistantConsent,
  useAssistantTradingStatus,
  useExecuteAssistantTrade,
  useRequestAssistantConsent,
  useRevokeAssistantConsent,
} from "@/hooks/use-ai-assistant";

export default function Account() {
  const { user, logout, updateProfile } = useAuth();
  const { chain } = useChain();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [telemetryOptIn, setTelemetryOptIn] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [assistantMode, setAssistantMode] = useState<"paper" | "live">("paper");
  const [walletsByChain, setWalletsByChain] = useState<Record<string, string>>({});
  const [confirmationText, setConfirmationText] = useState("I_APPROVE_ASSISTANT_TRADING");
  const [tradeChain, setTradeChain] = useState("solana");
  const [tradeContract, setTradeContract] = useState("");
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [tradeNotional, setTradeNotional] = useState("25");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const enabledChains = SUPPORTED_CHAINS.filter((item) => item !== "all");

  const tradingStatusQuery = useAssistantTradingStatus();
  const requestConsent = useRequestAssistantConsent();
  const approveConsent = useApproveAssistantConsent();
  const revokeConsent = useRevokeAssistantConsent();
  const executeTrade = useExecuteAssistantTrade();

  const trading = tradingStatusQuery.data?.trading;

  const compressImageToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const maxSize = 256;
          const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("Could not process image"));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);

          let quality = 0.82;
          let output = canvas.toDataURL("image/jpeg", quality);
          while (output.length > 220000 && quality > 0.5) {
            quality -= 0.08;
            output = canvas.toDataURL("image/jpeg", quality);
          }

          URL.revokeObjectURL(objectUrl);
          resolve(output);
        } catch (error) {
          URL.revokeObjectURL(objectUrl);
          reject(error instanceof Error ? error : new Error("Image processing failed"));
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Invalid image file"));
      };
      img.src = objectUrl;
    });
  };

  useEffect(() => {
    setUsername(user?.username || "");
    setDisplayName(user?.display_name || user?.username || "");
    setAvatarUrl(user?.avatar_url || "");
    setTelemetryOptIn(Boolean(user?.telemetry_opt_in));
  }, [user]);

  useEffect(() => {
    const incoming = trading?.wallets_by_chain || {};
    const next: Record<string, string> = {};
    for (const chainName of enabledChains) {
      next[chainName] = String(incoming[chainName] || walletsByChain[chainName] || "");
    }
    setWalletsByChain(next);
    if (trading?.mode === "paper" || trading?.mode === "live") {
      setAssistantMode(trading.mode);
    }
  }, [trading?.wallets_by_chain, trading?.mode]);

  const activeName = displayName || username || "User";
  const initials = activeName.slice(0, 2).toUpperCase();
  const hasAvatar = Boolean(avatarUrl.trim());

  const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Use an image under 2MB.", variant: "destructive" });
      return;
    }
    try {
      const compressed = await compressImageToDataUrl(file);
      setAvatarUrl(compressed);
      toast({ title: "Image ready", description: "Profile picture optimized for saving." });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Could not process image.",
        variant: "destructive",
      });
    }
  };

  const saveProfile = async () => {
    if (!username.trim()) {
      toast({ title: "Username required", description: "Please enter a username.", variant: "destructive" });
      return;
    }
    setIsSaving(true);
    try {
      await updateProfile({
        username: username.trim(),
        display_name: displayName.trim() || username.trim(),
        avatar_url: avatarUrl.trim(),
        telemetry_opt_in: telemetryOptIn,
      });
      toast({ title: "Profile updated", description: "Your profile changes were saved." });
    } catch (error) {
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Could not update profile.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const deleteProfilePicture = async () => {
    if (isSaving) return;
    setAvatarUrl("");
    setIsSaving(true);
    try {
      await updateProfile({
        username: username.trim(),
        display_name: displayName.trim() || username.trim(),
        avatar_url: "",
        telemetry_opt_in: telemetryOptIn,
      });
      toast({ title: "Profile picture removed", description: "Your avatar has been deleted." });
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "Could not remove profile picture.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestAssistantConsent = async () => {
    try {
      await requestConsent.mutateAsync({
        mode: assistantMode,
        wallets_by_chain: walletsByChain,
      });
      toast({ title: "Consent requested", description: "Approve consent to enable assistant trading." });
    } catch (error) {
      toast({ title: "Consent request failed", description: error instanceof Error ? error.message : "Request failed", variant: "destructive" });
    }
  };

  const handleApproveAssistantConsent = async () => {
    const consentId = String(trading?.consent_id || "");
    if (!consentId) {
      toast({ title: "Missing consent", description: "Request consent first.", variant: "destructive" });
      return;
    }
    try {
      await approveConsent.mutateAsync({
        consent_id: consentId,
        confirmation_text: confirmationText,
      });
      toast({ title: "Assistant trading enabled", description: "Permission is active. You can revoke anytime." });
    } catch (error) {
      toast({ title: "Approve failed", description: error instanceof Error ? error.message : "Approval failed", variant: "destructive" });
    }
  };

  const handleRevokeAssistantConsent = async () => {
    try {
      await revokeConsent.mutateAsync();
      toast({ title: "Assistant trading revoked", description: "Assistant no longer has trading permission." });
    } catch (error) {
      toast({ title: "Revoke failed", description: error instanceof Error ? error.message : "Revoke failed", variant: "destructive" });
    }
  };

  const handleExecuteAssistantTrade = async () => {
    const notionalValue = Number(tradeNotional);
    if (!tradeContract.trim() || !Number.isFinite(notionalValue) || notionalValue <= 0) {
      toast({ title: "Invalid trade", description: "Set contract and a valid notional amount.", variant: "destructive" });
      return;
    }
    try {
      await executeTrade.mutateAsync({
        chain: tradeChain,
        contract_address: tradeContract.trim(),
        side: tradeSide,
        notional_usd: notionalValue,
        mode: assistantMode,
      });
      toast({ title: "Trade submitted", description: `Assistant ${tradeSide.toUpperCase()} processed for ${tradeChain}.` });
      setTradeContract("");
    } catch (error) {
      toast({ title: "Trade blocked", description: error instanceof Error ? error.message : "Execution failed", variant: "destructive" });
    }
  };

  return (
    <Layout>
      <div className="max-w-lg mx-auto space-y-4">
        <Card className="solana-card animate-fade-in-up">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <Avatar className="h-20 w-20">
                {avatarUrl ? <AvatarImage src={avatarUrl} alt={activeName} /> : null}
                <AvatarFallback className="bg-primary text-primary-foreground text-xl">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="text-center">
                <h2 className="text-xl font-bold" data-testid="text-username">
                  @{username || "user"}
                </h2>
                <p className="text-sm text-muted-foreground" data-testid="text-email">
                  {user?.email}
                </p>
                {user?.is_admin && (
                  <Badge variant="outline" className="mt-2 text-amber-400 border-amber-400/30">
                    <Shield className="w-3 h-3 mr-1" /> Admin
                  </Badge>
                )}
                <Badge variant="outline" className="solana-badge mt-2">Profile Hub</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="solana-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-4 w-4" />
              Edit Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="profile-username">Username</Label>
              <Input id="profile-username" value={username} onChange={(e) => setUsername(e.target.value)} data-testid="input-profile-username" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-display-name">Display Name</Label>
              <Input id="profile-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="input-profile-display-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-avatar-url">Profile Picture URL</Label>
              <Input id="profile-avatar-url" placeholder="https://..." value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} data-testid="input-profile-avatar-url" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/60 p-3 bg-muted/30">
              <div>
                <p className="text-sm font-medium">Dev telemetry consent</p>
                <p className="text-xs text-muted-foreground">Allow hashed device/network fingerprinting for rug-dev linkage (no raw IP stored).</p>
              </div>
              <input
                type="checkbox"
                checked={telemetryOptIn}
                onChange={(e) => setTelemetryOptIn(e.target.checked)}
                className="h-4 w-4"
                data-testid="toggle-telemetry-opt-in"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarFile} className="hidden" />
              <Button variant="outline" type="button" onClick={() => fileInputRef.current?.click()} data-testid="button-upload-avatar">
                <Camera className="h-4 w-4 mr-2" />
                {hasAvatar ? "Change Picture" : "Upload Picture"}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={!hasAvatar || isSaving}
                    data-testid="button-delete-avatar"
                  >
                    Delete Picture
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete profile picture?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove your current profile photo from your account.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={deleteProfilePicture}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button type="button" onClick={saveProfile} disabled={isSaving} data-testid="button-save-profile">
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="solana-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-4 w-4" />
              Account Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">Username</span>
              <span className="text-sm font-medium">{user?.username || username}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">Display Name</span>
              <span className="text-sm font-medium">{user?.display_name || displayName || "-"}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm font-medium">{user?.email}</span>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <span className="text-sm text-muted-foreground">2FA</span>
              <Badge variant={user?.totp_enabled ? "default" : "outline"}>
                {user?.totp_enabled ? "Enabled" : "Disabled"}
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="solana-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Quick Links
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <a href="/scanner">
              <Button variant="outline" className="w-full justify-start" data-testid="button-goto-scanner">
                <TrendingUp className="w-4 h-4 mr-2" />
                Alpha Scanner
              </Button>
            </a>
            <a href="/rugshield">
              <Button variant="outline" className="w-full justify-start" data-testid="button-goto-rugshield">
                <Shield className="w-4 h-4 mr-2" />
                Token Risk Scanner
              </Button>
            </a>
          </CardContent>
        </Card>

        <Card className="solana-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Assistant Trading Control</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Assistant can only trade after explicit consent approval. Configure wallet per chain and revoke anytime.
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
              <span className="text-sm">Status</span>
              <Badge variant={trading?.enabled ? "default" : "outline"}>{trading?.enabled ? "Enabled" : trading?.pending_approval ? "Pending Approval" : "Disabled"}</Badge>
            </div>
            <div className="space-y-2">
              <Label>Mode</Label>
              <select
                value={assistantMode}
                onChange={(e) => setAssistantMode(e.target.value as "paper" | "live")}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="paper">Paper</option>
                <option value="live">Live</option>
              </select>
            </div>
            <div className="space-y-3">
              <Label>Wallets By Chain</Label>
              {enabledChains.map((chainName) => (
                <div key={chainName} className="space-y-1">
                  <Label htmlFor={`wallet-${chainName}`} className="text-xs uppercase text-muted-foreground">{chainName}</Label>
                  <Input
                    id={`wallet-${chainName}`}
                    placeholder={`Wallet for ${chainName}`}
                    value={walletsByChain[chainName] || ""}
                    onChange={(e) => setWalletsByChain((prev) => ({ ...prev, [chainName]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="assistant-confirmation">Approval Phrase</Label>
              <Input
                id="assistant-confirmation"
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleRequestAssistantConsent} disabled={requestConsent.isPending}>
                {requestConsent.isPending ? "Requesting..." : "Request Consent"}
              </Button>
              <Button variant="outline" onClick={handleApproveAssistantConsent} disabled={approveConsent.isPending || !trading?.pending_approval}>
                {approveConsent.isPending ? "Approving..." : "Approve Consent"}
              </Button>
              <Button variant="outline" onClick={handleRevokeAssistantConsent} disabled={revokeConsent.isPending}>
                {revokeConsent.isPending ? "Revoking..." : "Revoke"}
              </Button>
            </div>
            <div className="rounded-lg border border-border/60 p-3 space-y-3">
              <p className="text-sm font-medium">Execute Assistant Trade</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <select
                  value={tradeChain}
                  onChange={(e) => setTradeChain(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  {enabledChains.map((chainName) => (
                    <option key={chainName} value={chainName}>{chainName}</option>
                  ))}
                </select>
                <select
                  value={tradeSide}
                  onChange={(e) => setTradeSide(e.target.value as "buy" | "sell")}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="buy">BUY</option>
                  <option value="sell">SELL</option>
                </select>
              </div>
              <Input
                placeholder="Contract address"
                value={tradeContract}
                onChange={(e) => setTradeContract(e.target.value)}
              />
              <Input
                type="number"
                min={1}
                step="0.01"
                placeholder="Notional USD"
                value={tradeNotional}
                onChange={(e) => setTradeNotional(e.target.value)}
              />
              <Button onClick={handleExecuteAssistantTrade} disabled={executeTrade.isPending || !trading?.enabled}>
                {executeTrade.isPending ? "Executing..." : `Execute ${tradeSide.toUpperCase()}`}
              </Button>
              <p className="text-xs text-muted-foreground">Current global chain context: {chain}</p>
            </div>
          </CardContent>
        </Card>

        <Button
          variant="outline"
          className="w-full text-destructive border-destructive/20"
          onClick={logout}
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </Layout>
  );
}
