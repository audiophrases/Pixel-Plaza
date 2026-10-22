import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import type { PlazaConnection } from '../plaza';
import LobbyScene from '../game/scenes/LobbyScene';

interface PhaserGameProps {
  connection: PlazaConnection;
  onPick?: (id: string) => void; // a classmate was clicked on the map
}

export default function PhaserGame({ connection, onPick }: PhaserGameProps) {
  const gameRef = useRef<HTMLDivElement>(null);
  const phaserGameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!gameRef.current) return;

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: '100%',
      height: '100%',
      parent: gameRef.current,
      pixelArt: true,
      physics: {
        default: 'arcade',
        arcade: {
          gravity: { x: 0, y: 0 },
          debug: false
        }
      },
      scene: [LobbyScene],
      backgroundColor: '#f7f7f9',
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
      }
    };

    phaserGameRef.current = new Phaser.Game(config);
    
    phaserGameRef.current.scene.start('LobbyScene', { connection, onPick });

    return () => {
      phaserGameRef.current?.destroy(true);
      phaserGameRef.current = null;
    };
  }, [connection, onPick]);

  return <div ref={gameRef} style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 0 }} />;
}
