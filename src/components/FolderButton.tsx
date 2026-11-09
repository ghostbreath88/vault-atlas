import { FolderSync } from 'lucide-react';
import { useStore } from '../store';
import { isNative } from '../native';
import { go } from '../ui';

/** Android: "Refresh from folder" — rereads the connected vault folder and rebuilds search, links and graph. */
export function RefreshFolderButton({ small }: { small?: boolean }) {
  const { folder, vault, settings } = useStore((s) => s);
  if (!isNative || !folder?.connected || !vault || settings.folderVaultId !== vault.id) return null;
  return (
    <button className={'btn' + (small ? ' sm' : '') + ' primary'} data-testid="button-refresh-folder"
      onClick={() => go(`#/import?folder=refresh&return=${encodeURIComponent(location.hash || '#/')}`)}>
      <FolderSync />Refresh from folder
    </button>
  );
}
