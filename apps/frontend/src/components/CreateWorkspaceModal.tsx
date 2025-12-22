import { useState } from "react";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";

import { useEscapeKey } from "../hooks/useEscapeKey";
import { useCreateWorkspace } from "../hooks/useWorkspaces";

interface CreateWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateWorkspaceModal: FC<CreateWorkspaceModalProps> = ({
  isOpen,
  onClose,
}) => {
  const navigate = useNavigate();
  const createWorkspace = useCreateWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const handleClose = () => {
    setName("");
    setDescription("");
    onClose();
  };

  useEscapeKey(isOpen, handleClose);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      const workspace = await createWorkspace.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      setName("");
      setDescription("");
      onClose();
      navigate(`/workspaces/${workspace.id}`);
    } catch {
      // Error is handled by toast in the hook
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border-2 border-neutral-300 bg-white p-10 shadow-dramatic dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-8 text-4xl font-black tracking-tight text-neutral-900 dark:text-neutral-50">
          Create Workspace
        </h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="name"
              className="mb-2.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Name *
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-3 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              required
              autoFocus
            />
          </div>
          <div>
            <label
              htmlFor="description"
              className="mb-2.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-xl border-2 border-neutral-300 bg-white px-4 py-3 text-neutral-900 transition-all duration-200 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:border-primary-500 dark:focus:ring-primary-400"
              rows={4}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={createWorkspace.isPending || !name.trim()}
              className="flex-1 transform rounded-xl bg-gradient-primary px-8 py-4 font-bold text-white transition-all duration-200 hover:scale-[1.03] hover:shadow-colored active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
            >
              {createWorkspace.isPending ? "Creating..." : "Create"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={createWorkspace.isPending}
              className="flex-1 transform rounded-xl border-2 border-neutral-300 bg-white px-8 py-4 font-bold text-neutral-900 transition-all duration-200 hover:scale-[1.02] hover:border-neutral-400 hover:bg-neutral-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
