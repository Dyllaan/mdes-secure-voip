import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

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

    if (variant === 'labelled') {
        return (
            <div className="py-3 w-full">
                <div className="space-y-2 w-full flex flex-col gap-0.5">
                    <label className="text-sm font-medium text-foreground">
                        {label}
                    </label>
                    <div className="w-full">
                        {children}
                    </div>
                </div>
            </div>
        );
    }

    // Interactive variant
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

    return (
        <>
            <div 
                className={`p-4 transition-colors ${
                    disabled 
                        ? 'opacity-50 cursor-not-allowed' 
                        : 'hover:bg-muted/50 cursor-pointer'
                }`}
                onClick={handleClick}
            >
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
            </div>

            {showConfirm && (
                <div 
                    className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
                    onClick={() => setShowConfirm(false)}
                >
                    <div 
                        className="bg-card rounded-lg border shadow-lg max-w-md w-full p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-3 mb-4">
                            <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                                <AlertTriangle className="w-5 h-5 text-destructive" />
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-semibold text-foreground mb-1">
                                    {label}
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    Are you sure? This action cannot be undone.
                                </p>
                            </div>
                        </div>
                        
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowConfirm(false)}
                                className="flex-1 px-4 py-2 rounded-md border hover:bg-muted transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirm}
                                className="flex-1 px-4 py-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                            >
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}