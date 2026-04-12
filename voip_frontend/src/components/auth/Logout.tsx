import { useAuth } from "@/hooks/auth/useAuth";

import { LogOut } from "lucide-react";

export default function Logout() {
    const { logout } = useAuth();


    return (
        <button
            onClick={() => logout()}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-lg text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
        >
            <LogOut className="h-4 w-4" />
            Logout
        </button>

    );
}