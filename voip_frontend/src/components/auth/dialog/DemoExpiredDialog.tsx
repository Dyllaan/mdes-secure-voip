import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface DemoExpiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: string;
  onDelete: () => Promise<void> | void;
  isDeleting: boolean;
  error: string | null;
}

export default function DemoExpiredDialog({
  open,
  onOpenChange,
  message,
  onDelete,
  isDeleting,
  error,
}: DemoExpiredDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Demo Ended</DialogTitle>
          <DialogDescription>
            {message}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive" data-testid="demo-delete-error">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="destructive"
            className="w-full"
            onClick={() => void onDelete()}
            disabled={isDeleting}
            data-testid="demo-delete-submit"
          >
            {isDeleting ? 'Deleting Demo Account...' : 'Delete Demo Account'}
          </Button>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={isDeleting}
              data-testid="demo-delete-close"
            >
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
