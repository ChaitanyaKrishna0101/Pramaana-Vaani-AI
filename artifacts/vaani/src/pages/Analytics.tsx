import React from "react";
import { Shell } from "@/components/layout/Shell";
import { useGetVaaniAnalytics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

export default function Analytics() {
  const { data, isLoading } = useGetVaaniAnalytics();

  return (
    <Shell>
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Analytics Overview</h2>
          <p className="text-muted-foreground">Real-time performance and insights of VAANI dispatch.</p>
        </div>

        {isLoading ? (
          <div className="text-muted-foreground">Loading analytics...</div>
        ) : data ? (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card className="bg-card/50 border-border">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{data.totalCalls}</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 border-border">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Accuracy</CardTitle>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-500">{data.accuracyPercent}%</div>
                </CardContent>
              </Card>
              <Card className="bg-card/50 border-border">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Distressed Calls</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-destructive">{data.distressedCount}</div>
                </CardContent>
              </Card>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="bg-card/50 border-border">
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Escalation Levels</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-green-500 font-medium">Level 1 (Automated)</span>
                    <span className="font-bold">{data.level1Count}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-yellow-500 font-medium">Level 2 (Review)</span>
                    <span className="font-bold">{data.level2Count}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-destructive font-medium">Level 3 (Human Escalate)</span>
                    <span className="font-bold">{data.level3Count}</span>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="bg-card/50 border-border">
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Language Breakdown</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {Object.entries(data.languageBreakdown || {}).map(([lang, count]) => (
                    <div key={lang} className="flex items-center justify-between">
                      <span className="text-sm font-medium">{lang}</span>
                      <span className="font-bold">{count}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </>
        ) : (
          <div className="text-muted-foreground">No data available</div>
        )}
      </div>
    </Shell>
  );
}
