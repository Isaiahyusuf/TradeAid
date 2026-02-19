import { Layout } from "@/components/Layout";
import { Card, CardContent } from "@/components/ui/card";
import { Shield } from "lucide-react";

export default function Subscription() {
  return (
    <Layout>
      <div className="max-w-lg mx-auto">
        <Card>
          <CardContent className="pt-6 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-2">Subscription Management</h2>
            <p className="text-sm text-muted-foreground">
              Subscription features coming soon.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
