import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="w-full max-w-md">
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
          <h1 className="text-xl font-semibold">Link Not Found</h1>
          <p className="text-sm text-muted-foreground">
            This link is no longer valid or has expired.
            <br />
            If you need help, please contact our support team.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
