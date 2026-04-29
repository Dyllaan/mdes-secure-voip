import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Back({showBack} : {showBack?: boolean}) {
  const navigate = useNavigate();

  const handleBack = () => {
    navigate('/');
  };

  return (
    <div className="py-2">
      {showBack !== false ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleBack}
          aria-label="Go back to home"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
      ) : (
        <span aria-hidden="true" className="inline-block w-9 h-9" />
      )}
    </div>
  );
}
