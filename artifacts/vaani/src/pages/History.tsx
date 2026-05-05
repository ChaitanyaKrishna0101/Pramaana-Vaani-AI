import React from "react";
import { Shell } from "@/components/layout/Shell";
import { useGetVaaniHistory } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

export default function History() {
  const { data, isLoading } = useGetVaaniHistory();

  return (
    <Shell>
      <div className="p-8 h-full flex flex-col">
        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">Call History</h2>
          <p className="text-muted-foreground">Chronological log of all intercepted dispatch calls.</p>
        </div>

        <div className="flex-1 overflow-auto rounded-md border border-border bg-card/50">
          <Table>
            <TableHeader className="bg-background sticky top-0 z-10">
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Emotion</TableHead>
                <TableHead>Level</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>Transcript</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading history...</TableCell>
                </TableRow>
              ) : data && data.length > 0 ? (
                data.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {format(new Date(record.createdAt), "MMM d, HH:mm:ss")}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-background text-xs">{record.language}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium px-2 py-1 rounded ${record.emotion === 'DISTRESSED' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
                        {record.emotion}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`font-bold ${record.level === 3 ? 'text-destructive' : record.level === 2 ? 'text-yellow-500' : 'text-green-500'}`}>
                        L{record.level || '-'}
                      </span>
                    </TableCell>
                    <TableCell className="font-medium max-w-[200px] truncate">{record.issue}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[300px] truncate">{record.transcript}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No records found</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </Shell>
  );
}
