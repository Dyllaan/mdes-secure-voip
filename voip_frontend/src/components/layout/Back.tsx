import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export default function Back({showBack} : {showBack?: boolean}) {
  const navigate = useNavigate();

  const handleBack = () => {
    navigate('/');
  };

  return (
    <div onClick={handleBack} className="px-4 py-4 h-10 transition-colors cursor-pointer">
      {showBack !== false ? <ArrowLeft className="w-5 h-5 text-muted-foreground hover:bg-muted/50" /> : <span className="w-5 h-5" />}
    </div>
  );
}
