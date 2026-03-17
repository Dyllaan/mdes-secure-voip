import { Button } from "@/components/ui/button";

interface InviteCodeButtonProps {
    inviteCode: string | null;
    onCreateInvite: () => void;
}

export default function InviteCodeButton({ inviteCode, onCreateInvite }: InviteCodeButtonProps) {
    return (
        <div className="mt-2">
            {inviteCode ? (
                <div className="flex items-center gap-2">
                    <code className="text-xs bg-muted px-2 py-1 rounded font-mono flex-1">
                        {inviteCode}
                    </code>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => navigator.clipboard.writeText(inviteCode)}
                    >
                        Copy
                    </Button>
                </div>
            ) : (
                <Button
                    size="sm"
                    variant="ghost"
                    className="w-full text-xs text-muted-foreground"
                    onClick={onCreateInvite}
                >
                    Generate invite code
                </Button>
            )}
        </div>
    );
}