import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquare } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { addComment, fetchComments, qk, resolveComment } from "@/lib/data";
import type { Profile } from "@/lib/data";

/** QA conversation attached to one feature. */
export function CommentsSection({
  projectId,
  featureId,
  profiles,
  canResolve,
}: {
  projectId: string
  featureId: string
  profiles: Profile[]
  canResolve: boolean
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");

  const commentsQuery = useQuery({
    queryKey: qk.comments(featureId),
    queryFn: () => fetchComments(featureId),
    enabled: Boolean(user),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: qk.comments(featureId) });

  const post = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sign in first");
      const text = body.trim();
      if (text.length < 2) throw new Error("Write a comment first");
      return addComment({ projectId, featureId, authorId: user.id, body: text.slice(0, 800) });
    },
    onSuccess: () => {
      setBody("");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not add the comment"),
  });

  const resolve = useMutation({
    mutationFn: (input: { id: string; resolved: boolean }) =>
      resolveComment(input.id, input.resolved),
    onSuccess: invalidate,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update"),
  });

  const comments = commentsQuery.data ?? [];
  const nameOf = (id: string | null) => {
    if (!id) return "Unknown";
    const profile = profiles.find((row) => row.id === id);
    return profile?.display_name ?? profile?.email ?? id.slice(0, 8);
  };

  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
        <MessageSquare className="size-3.5" /> QA comments
      </Label>

      {comments.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No comments on this feature yet.</p>
      )}

      {comments.map((comment) => (
        <div
          key={comment.id}
          className={`rounded border p-2 text-[11px] ${
            comment.resolved ? "border-border text-muted-foreground" : "border-warning/40 bg-warning/5"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-foreground">{nameOf(comment.author_id)}</span>
            <span className="text-muted-foreground">
              {new Date(comment.created_at).toLocaleString()}
            </span>
            {(canResolve || comment.author_id === user?.id) && (
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-6"
                aria-label={comment.resolved ? "Reopen comment" : "Mark resolved"}
                onClick={() => resolve.mutate({ id: comment.id, resolved: !comment.resolved })}
              >
                <Check className={`size-3.5 ${comment.resolved ? "text-primary" : ""}`} />
              </Button>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap">{comment.body}</p>
        </div>
      ))}

      <Textarea
        className="min-h-14 text-xs"
        maxLength={800}
        placeholder="e.g. Check the western boundary of this building."
        value={body}
        onChange={(event) => setBody(event.target.value)}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full text-xs"
        disabled={post.isPending}
        onClick={() => post.mutate()}
      >
        Add comment
      </Button>
    </div>
  );
}
