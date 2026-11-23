"use client";
import { useState } from "react";
export function JaneAvatar() {
  const [failed, setFailed] = useState(false);
  return (
    <div className="jane-avatar">
      {failed ? (
        <div className="jane-fallback">
          Jane <span>你的旅行英语伙伴</span>
        </div>
      ) : (
        <img
          src="/jane/jane-welcome-v1.png"
          alt="扎着马尾、戴黑框眼镜的英语助教 Jane 微笑挥手"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
