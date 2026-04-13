"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Users,
  Bot,
  Phone,
  PhoneCall,
  GitBranch,
  Hash,
  Server,
  ArrowUpFromLine,
  ArrowDownToLine,
  Settings,
  FolderKanban,
  Box,
  UsersRound,
  Search,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Plus,
  LogOut,
} from "lucide-react";
import { useState, useEffect } from "react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  children?: { label: string; href: string }[];
  action?: "add";
}

const navItems: NavItem[] = [
  {
    label: "Overview",
    href: "/",
    icon: <LayoutDashboard className="size-4" />,
  },
  {
    label: "Sessions",
    href: "/sessions",
    icon: <Users className="size-4" />,
  },
  {
    label: "Agents",
    href: "/agents",
    icon: <Bot className="size-4" />,
    action: "add",
  },
  {
    label: "Telephony",
    href: "/telephony",
    icon: <Phone className="size-4" />,
    children: [
      { label: "Calls", href: "/telephony/calls" },
      { label: "Dispatch rules", href: "/telephony/dispatch-rules" },
      { label: "Phone numbers", href: "/telephony/phone-numbers" },
      { label: "SIP trunks", href: "/telephony/sip-trunks" },
    ],
  },
  {
    label: "Egresses",
    href: "/egresses",
    icon: <ArrowUpFromLine className="size-4" />,
  },
  {
    label: "Ingresses",
    href: "/ingresses",
    icon: <ArrowDownToLine className="size-4" />,
  },
  {
    label: "Settings",
    href: "/settings",
    icon: <Settings className="size-4" />,
    children: [
      { label: "Project", href: "/settings/project" },
      { label: "Sandbox", href: "/settings/sandbox" },
      { label: "Team members", href: "/settings/team-members" },
      { label: "API keys", href: "/settings/api-keys" },
      { label: "Webhooks", href: "/settings/webhooks" },
    ],
  },
];

export function LiveKitSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ firstName: string; lastName: string; email: string; role: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data?.user) setUser(data.user); });
  }, []);

  const displayName = user ? `${user.firstName} ${user.lastName}` : "...";
  const initials = user ? user.firstName.charAt(0).toUpperCase() : "?";

  const [expandedSections, setExpandedSections] = useState<string[]>(() => {
    const expanded: string[] = [];
    navItems.forEach((item) => {
      if (item.children) {
        const isChildActive = item.children.some((child) => pathname === child.href);
        if (isChildActive) expanded.push(item.label);
      }
    });
    return expanded;
  });

  const toggleSection = (label: string) => {
    setExpandedSections((prev) =>
      prev.includes(label) ? prev.filter((s) => s !== label) : [...prev, label]
    );
  };

  const isActive = (href: string, children?: NavItem["children"]) => {
    if (children) {
      return children.some((child) => pathname === child.href) || pathname === href;
    }
    return pathname === href;
  };

  return (
    <aside className="flex h-screen w-[220px] flex-col border-r bg-sidebar shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-4">
        <span className="text-lg font-bold tracking-tight text-sidebar-foreground">
          Live<span className="text-primary">Kit</span>
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-1 space-y-0.5">
        {navItems.map((item) => {
          const active = isActive(item.href, item.children);
          const expanded = expandedSections.includes(item.label);
          const hasChildren = !!item.children;

          return (
            <div key={item.label}>
              <div className="flex items-center">
                {hasChildren ? (
                  <button
                    onClick={() => toggleSection(item.label)}
                    className={cn(
                      "flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                  >
                    {item.icon}
                    <span className="flex-1 text-left">{item.label}</span>
                    {expanded ? (
                      <ChevronDown className="size-3.5 opacity-50" />
                    ) : (
                      <ChevronRight className="size-3.5 opacity-50" />
                    )}
                  </button>
                ) : (
                  <Link
                    href={item.href}
                    className={cn(
                      "flex flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                )}
                {item.action === "add" && (
                  <Button variant="ghost" size="icon-xs" className="ml-0.5 text-muted-foreground" asChild>
                    <Link href="/agents/builder">
                      <Plus className="size-3.5" />
                    </Link>
                  </Button>
                )}
              </div>

              {hasChildren && expanded && (
                <div className="ml-5 mt-0.5 space-y-0.5 border-l pl-3">
                  {item.children!.map((child) => {
                    const childActive = pathname === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "flex items-center rounded-lg px-3 py-1.5 text-sm transition-colors",
                          childActive
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                            : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                        )}
                      >
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="border-t px-3 py-2 space-y-0.5">
        <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors">
          <Search className="size-4" />
          <span>Search</span>
          <kbd className="ml-auto rounded-md border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono">
            ⌘K
          </kbd>
        </button>
        <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors">
          <HelpCircle className="size-4" />
          <span>Support</span>
          <ChevronRight className="ml-auto size-3.5 opacity-50" />
        </button>
      </div>

      {/* User */}
      <div className="border-t px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Avatar size="sm">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
            <span className="text-sm text-sidebar-foreground/70 truncate">{displayName}</span>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-destructive"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
              router.refresh();
            }}
          >
            <LogOut className="size-3.5" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
