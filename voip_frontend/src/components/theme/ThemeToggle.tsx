import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <div onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="flex items-center gap-2">
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    <span className="text-sm">{theme === "dark" ? "Dark Mode" : "Light Mode"}</span>
    </div>
  )
}