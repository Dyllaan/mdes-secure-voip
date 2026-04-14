import { useState, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Users, Search, MoreHorizontal, UserMinus } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import type { Hub, Member } from "@/types/hub.types";
import InviteCodeButton from "./InviteCodeButton";

const ROLE_ORDER: Record<Member["role"], number> = {
  owner: 0,
  admin: 1,
  member: 2,
  bot: 3,
};

const AVATAR_COLORS: [string, string][] = [
  ["bg-violet-100 dark:bg-violet-900", "text-violet-700 dark:text-violet-300"],
  ["bg-blue-100 dark:bg-blue-900", "text-blue-700 dark:text-blue-300"],
  ["bg-emerald-100 dark:bg-emerald-900", "text-emerald-700 dark:text-emerald-300"],
  ["bg-amber-100 dark:bg-amber-900", "text-amber-700 dark:text-amber-300"],
  ["bg-rose-100 dark:bg-rose-900", "text-rose-700 dark:text-rose-300"],
  ["bg-sky-100 dark:bg-sky-900", "text-sky-700 dark:text-sky-300"],
];

function avatarColor(userId: string): [string, string] {
  return AVATAR_COLORS[userId.charCodeAt(0) % AVATAR_COLORS.length];
}

function initials(userId: string): string {
  return userId.replace(/^usr_/, "").slice(0, 2).toUpperCase();
}

const ROLE_BADGE_VARIANT: Record<Member["role"], string> = {
  owner: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300 border-violet-200 dark:border-violet-800",
  admin: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  member: "bg-secondary text-secondary-foreground border-border",
  bot: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800",
};


function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}


function MemberRow({
    member,
    kickMember,
    viewerIsOwner,
    }: {
    member: Member;
    kickMember?: (memberId: string) => void;
    viewerIsOwner: boolean;
}) {
  const [bg, text] = avatarColor(member.username);

  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors">
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback className={`text-xs font-medium ${bg} ${text}`}>
          {initials(member.username)}
        </AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{member.username}</span>
        <span className="text-[11px] text-muted-foreground">
          Joined {format(new Date(member.joinedAt), "d MMM yyyy")} ·{" "}
          {formatDistanceToNow(new Date(member.joinedAt), { addSuffix: true })}
        </span>
      </div>

      <Badge
        variant="outline"
        className={`shrink-0 text-[10px] font-medium px-2 py-0 capitalize ${ROLE_BADGE_VARIANT[member.role]}`}
      >
        {member.role}
      </Badge>

        {kickMember && member.role !== "owner" && viewerIsOwner ? (
            <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => kickMember?.(member.id)}
            >
              <UserMinus className="mr-2 h-3.5 w-3.5" />
              Remove from hub
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        ) : (
            <span className="w-7 shrink-0" />
        )}
    </div>
  );
}

interface HubMembersDrawerProps {
  hub: Hub;
  members: Member[];
  trigger?: React.ReactNode;
  kickMember: (memberId: string) => void;
  inviteCode: string | null;
  onCreateInvite: () => void;
  viewerIsOwner: boolean;
}

export function HubMembersDrawer({
    hub,
    members,
    trigger,
    kickMember,
    inviteCode,
    onCreateInvite,
    viewerIsOwner

}: HubMembersDrawerProps) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("joinedAt-desc");

  const stats = useMemo(() => {
    const c = { owner: 0, admin: 0, member: 0, bot: 0 };
    members.forEach((m) => c[m.role]++);
    return c;
  }, [members]);

  const filtered = useMemo(() => {
    let list = members.filter((m) => {
      const matchSearch =
        !search ||
        m.username.toLowerCase().includes(search.toLowerCase()) ||
        m.id.toLowerCase().includes(search.toLowerCase());
      const matchRole = roleFilter === "all" || m.role === roleFilter;
      return matchSearch && matchRole;
    });

    list = [...list].sort((a, b) => {
      if (sortBy === "joinedAt-desc")
        return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
      if (sortBy === "joinedAt-asc")
        return new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime();
      if (sortBy === "role") return ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      return 0;
    });

    return list;
  }, [members, search, roleFilter, sortBy]);

  return (
    <Sheet>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <Users className="h-4 w-4" />
            Members
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">
              {members.length}
            </Badge>
          </Button>
        )}
      </SheetTrigger>

      <SheetContent className="flex w-[420px] flex-col gap-0 p-0 sm:max-w-[420px]">
        <SheetHeader className="px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-sm font-semibold text-violet-700 dark:bg-violet-900 dark:text-violet-300">
              {hub.name.slice(0, 2).toUpperCase()}
            </div>
            <SheetTitle className="text-base leading-tight">{hub.name}</SheetTitle>
          </div>
        </SheetHeader>

        <Separator />

        <div className="grid grid-cols-4 gap-2 px-5 py-3">
          <StatCard label="Total" value={members.length} />
          <StatCard label="Admins" value={stats.admin} />
          <StatCard label="Members" value={stats.member} />
          <StatCard label="Bots" value={stats.bot} />
        </div>

        <Separator />

        <div className="flex gap-2 px-5 py-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 h-8 text-sm"
              placeholder="Search members…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="h-8 w-[110px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All roles</SelectItem>
              <SelectItem value="owner">Owner</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="bot">Bot</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="h-8 w-[110px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="joinedAt-desc">Newest</SelectItem>
              <SelectItem value="joinedAt-asc">Oldest</SelectItem>
              <SelectItem value="role">Role</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator />

        <ScrollArea className="flex-1">
          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No members found
            </p>
          ) : (
            <div className="py-1">
              {filtered.map((m) => (
                <MemberRow
                    key={m.id}
                    member={m}
                    kickMember={kickMember}
                    viewerIsOwner={viewerIsOwner}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        <Separator />

        <div className="px-5 py-3">
          <InviteCodeButton inviteCode={inviteCode} onCreateInvite={onCreateInvite} />
        </div>
      </SheetContent>
    </Sheet>
  );
}