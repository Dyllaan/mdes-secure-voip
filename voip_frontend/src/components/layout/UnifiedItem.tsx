import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

interface UnifiedItemProps {
    label: string;
    description?: string;
    children?: React.ReactNode;
    variant?: 'default' | 'labelled';
    icon?: LucideIcon;
    to?: string;
    onClick?: () => void;
    destructive?: boolean;
    showChevron?: boolean;
    disabled?: boolean;
}

export default function UnifiedItem({
    label,
    description,
    children,
    variant = 'default',
    icon: Icon,
    to,
    onClick,
    destructive = false,
    showChevron = false,
    disabled = false,
}: UnifiedItemProps) {
    const navigate = useNavigate();
    const [showConfirm, setShowConfirm] = useState(false);
    const interactiveClassName = `w-full rounded-md p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        disabled
            ? 'opacity-50 cursor-not-allowed'
            : 'hover:bg-muted/50'
    }`;

    if (variant === 'labelled') {
        return (
            <div className="py-3 w-full">
                <div className="space-y-2 w-full flex flex-col gap-0.5">
                    <p className="text-sm font-medium text-foreground">
                        {label}
                    </p>
                    <div className="w-full">
                        {children}
                    </div>
                </div>
            </div>
        );
    }

    const handleClick = () => {
        if (disabled) return;
        
        if (destructive && onClick) {
            setShowConfirm(true);
        } else if (to) {
            navigate(to);
        } else if (onClick) {
            onClick();
        }
    };

    const handleConfirm = () => {
        onClick?.();
        setShowConfirm(false);
    };

    const itemContent = (
        <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
                <div className={`font-medium ${destructive ? 'text-destructive' : 'text-foreground'}`}>
                    {label}
                </div>
                {description && (
                    <div className="text-sm text-muted-foreground mt-1">
                        {description}
                    </div>
                )}
            </div>
            
            <div className="flex items-center gap-3 shrink-0">
                {children}
                {Icon && (
                    <Icon className={`w-5 h-5 ${destructive ? 'text-destructive' : 'text-muted-foreground'}`} />
                )}
                {showChevron && !Icon && (
                    <ChevronRight className={`w-5 h-5 ${destructive ? 'text-destructive' : 'text-muted-foreground'}`} />
                )}
            </div>
        </div>
    );

    return (
        <>
            {to && !destructive && !disabled ? (
                <Link to={to} className={interactiveClassName}>
                    {itemContent}
                </Link>
            ) : (
                <button
                    type="button"
                    className={interactiveClassName}
                    onClick={handleClick}
                    disabled={disabled}
                >
                    {itemContent}
                </button>
            )}

            <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-3">
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                                <AlertTriangle className="w-5 h-5 text-destructive" />
                            </span>
                            {label}
                        </DialogTitle>
                        <DialogDescription>
                            Are you sure? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>

                    <DialogFooter>
                        <button
                            type="button"
                            onClick={() => setShowConfirm(false)}
                            className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            className="inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            Confirm
                        </button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
