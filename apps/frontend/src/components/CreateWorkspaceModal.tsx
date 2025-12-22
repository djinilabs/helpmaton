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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white border-2 border-neutral-300 rounded-2xl shadow-dramatic p-10 max-w-md w-full dark:bg-neutral-900 dark:border-neutral-700">
        <h2 className="text-4xl font-black text-neutral-900 mb-8 tracking-tight dark:text-neutral-50">
          Create Workspace
        </h2>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-neutral-700 mb-2.5 dark:text-neutral-300"
            >
              Name *
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
              required
              autoFocus
            />
          </div>
          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium text-neutral-700 mb-2.5 dark:text-neutral-300"
            >
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border-2 border-neutral-300 rounded-xl bg-white px-4 py-3 text-neutral-900 focus:outline-none focus:ring-4 focus:ring-primary-500 focus:border-primary-500 transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:focus:ring-primary-400 dark:focus:border-primary-500"
              rows={4}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={createWorkspace.isPending || !name.trim()}
              className="flex-1 bg-gradient-primary px-8 py-4 text-white font-bold rounded-xl hover:shadow-colored disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none transition-all duration-200 transform hover:scale-[1.03] active:scale-[0.97]"
            >
              {createWorkspace.isPending ? "Creating..." : "Create"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={createWorkspace.isPending}
              className="flex-1 border-2 border-neutral-300 bg-white px-8 py-4 text-neutral-900 font-bold rounded-xl hover:bg-neutral-100 hover:border-neutral-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-50 dark:hover:bg-neutral-800 dark:hover:border-neutral-600"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
