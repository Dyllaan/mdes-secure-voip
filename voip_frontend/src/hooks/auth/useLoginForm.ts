import { useState } from "react";
import { useAuth } from "@/hooks/auth/useAuth";


const useLoginForm = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const { login } = useAuth();
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setLoading(true);
        
        await login(username, password);
        setLoading(false);
    }

  return {
    handleSubmit,
    loading,
    setUsername,
    setPassword,
    username,
    password
  };
};

export default useLoginForm;