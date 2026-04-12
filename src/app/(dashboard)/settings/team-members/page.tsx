"use client";

import { TopBar } from "@/components/livekit/top-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const members = [
  {
    name: "husein",
    email: "husein@example.com",
    role: "Owner",
    joined: "Apr 2026",
  },
];

export default function TeamMembersPage() {
  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Team members"
        breadcrumb={["husein", "Settings"]}
        actions={
          <Button size="sm">
            Invite member
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Name</th>
                    <th className="px-4 py-2.5 font-medium">Email</th>
                    <th className="px-4 py-2.5 font-medium">Role</th>
                    <th className="px-4 py-2.5 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr
                      key={m.email}
                      className="border-b last:border-0"
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Avatar className="size-7">
                            <AvatarFallback className="text-xs">
                              {m.name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-foreground font-medium">
                            {m.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-foreground/70">
                        {m.email}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant="secondary">
                          {m.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {m.joined}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
