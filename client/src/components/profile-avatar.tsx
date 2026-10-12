import { useEffect, useState } from "react";
import { Link } from "wouter";
import { UserRound } from "lucide-react";

interface ProfileAvatarProps {
  href?: string;
  username?: string | null;
  profileImage?: string | null;
  className?: string;
}

export default function ProfileAvatar({
  href = "/account",
  username,
  profileImage,
  className = "",
}: ProfileAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [profileImage]);

  return (
    <Link
      href={href}
      aria-label={username ? `My account: ${username}` : "My account"}
      title="My account"
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/35 bg-primary/10 text-primary transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${className}`}
    >
      {profileImage && !imageFailed ? (
        <img
          src={profileImage}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <span aria-hidden="true" className="flex h-full w-full items-center justify-center">
          {username?.trim() ? (
            <span className="text-sm font-bold uppercase">{username.trim().slice(0, 1)}</span>
          ) : (
            <UserRound className="h-5 w-5" />
          )}
        </span>
      )}
    </Link>
  );
}
