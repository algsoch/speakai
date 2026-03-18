import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { CalendarIcon, Github } from "lucide-react"

export function MaintainerAttribution() {
  return (
    <div className="flex justify-center mt-8 pb-8">
       <HoverCard>
        <HoverCardTrigger asChild>
          <a
            href="https://github.com/algsoch"
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-3 p-1.5 pr-4 rounded-full border bg-card/50 backdrop-blur-sm hover:bg-accent/50 hover:border-primary/20 transition-all duration-300"
          >
            <Avatar className="h-8 w-8 border shadow-sm group-hover:scale-105 transition-transform">
              <AvatarImage src="https://github.com/algsoch.png" alt="@algsoch" />
              <AvatarFallback>AG</AvatarFallback>
            </Avatar>
            <div className="flex flex-col text-left -space-y-0.5">
              <span className="text-xs font-semibold group-hover:text-primary transition-colors">@algsoch</span>
              <span className="text-[10px] text-muted-foreground">Project Maintainer</span>
            </div>
          </a>
        </HoverCardTrigger>
        <HoverCardContent className="w-80">
          <div className="flex justify-between space-x-4">
            <Avatar className="h-12 w-12">
              <AvatarImage src="https://github.com/algsoch.png" />
              <AvatarFallback>AG</AvatarFallback>
            </Avatar>
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">@algsoch</h4>
              <p className="text-sm text-muted-foreground">
                Building AI tools for everyone. Check out my other projects on GitHub.
              </p>
              <div className="flex items-center pt-2 text-xs text-muted-foreground">
                <Github className="mr-2 h-3.5 w-3.5" />
                <span>github.com/algsoch</span>
              </div>
            </div>
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  )
}
