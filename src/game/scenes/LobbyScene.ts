import Phaser from 'phaser';
import { AvatarFigure, FIGURE_BODY, FIGURE_TOP } from '../AvatarFigure';
import type { PlazaConnection, PlazaEvent, PlazaPlayer } from '../../plaza';

// Position updates go out at most this often; remote avatars glide between them.
const SEND_EVERY_MS = 100;

export default class LobbyScene extends Phaser.Scene {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private connection!: PlazaConnection;

  private playerEntities: { [id: string]: Phaser.GameObjects.Container } = {};
  private figures: { [id: string]: AvatarFigure } = {};
  private localPlayerContainer?: Phaser.GameObjects.Container;
  private sent = { x: 0, y: 0 };
  private lastSent = 0;

  constructor() {
    super('LobbyScene');
  }

  init(data: { connection: PlazaConnection }) {
    this.connection = data.connection;
  }

  preload() {
    this.load.image('plaza_bg', '/assets/plaza.jpg');
  }

  create() {
    // Add the background image
    const bg = this.add.image(0, 0, 'plaza_bg').setOrigin(0, 0);
    
    // Scale image to a reasonable size (not 4000x4000 which makes it too zoomed in)
    bg.setScale(2); // 2x scale makes it 2048x2048 if it was 1024x1024
    
    const mapWidth = bg.displayWidth;
    const mapHeight = bg.displayHeight;
    
    this.physics.world.setBounds(0, 0, mapWidth, mapHeight);

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
    }
    
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);

    // Create a StaticGroup for walls/buildings
    this.walls = this.physics.add.staticGroup();

    // Helper to create walls from top-left coordinates
    const createWall = (x: number, y: number, w: number, h: number) => {
      const rect = this.add.rectangle(x, y, w, h, 0xff0000, 0).setOrigin(0, 0);
      this.physics.add.existing(rect, true); // true = static body
      this.walls.add(rect);
    };

    // 1. Grand Plaza Hotel (Top Left/Center)
    createWall(0, 0, 1100, 480);
    
    // 2. Right Tower (Top Right)
    createWall(1100, 0, 948, 650);
    
    // 3. The Rusty Mug (Bottom Right)
    createWall(1400, 650, 648, 1398);
    
    // 4. Bottom Left Trees & Decor
    createWall(0, 850, 450, 1198);

    this.syncRoster();
    const unsubscribe = this.connection.subscribe(event => this.onPlazaEvent(event));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    this.events.once(Phaser.Scenes.Events.DESTROY, unsubscribe);
  }

  private onPlazaEvent(event: PlazaEvent) {
    if (event.t === 'roster') this.syncRoster();
    else if (event.t === 'join') this.addPlayer(event.player);
    else if (event.t === 'leave') this.removePlayer(event.id);
    else if (event.t === 'move' && event.id !== this.connection.selfId) {
      const container = this.playerEntities[event.id];
      if (!container) return;
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, x: event.x, y: event.y, duration: SEND_EVERY_MS });
    } else if (event.t === 'emote') {
      const container = this.playerEntities[event.id];
      if (container) this.showEmote(container, event.emote);
    }
  }

  // Draws exactly the connection's roster. After a reconnect the student has a
  // new id; their avatar stays where it was rather than jumping back.
  private syncRoster() {
    const previous = this.localPlayerContainer && { x: this.localPlayerContainer.x, y: this.localPlayerContainer.y };
    for (const id of Object.keys(this.playerEntities)) {
      if (!this.connection.players.has(id)) this.removePlayer(id);
    }
    for (const player of this.connection.players.values()) {
      if (!this.playerEntities[player.id]) this.addPlayer(player);
    }
    if (previous && this.localPlayerContainer) this.localPlayerContainer.setPosition(previous.x, previous.y);
  }

  private addPlayer(player: PlazaPlayer) {
    const isLocal = player.id === this.connection.selfId;

    const container = this.add.container(player.x, player.y);
    this.playerEntities[player.id] = container;
    const figure = AvatarFigure.create(this, container, player.id, player);
    if (figure) this.figures[player.id] = figure;
    else {
      // Fallback graphic if the avatar artwork has not loaded
      container.add(this.add.rectangle(0, -16, 32, 64, isLocal ? 0xFF5A5F : 0x4285F4));
    }

    // Nameplate, above the tallest hat and drawn over the figure
    const nameText = this.add.text(0, FIGURE_TOP - 12, player.name, {
      fontSize: '12px',
      fontFamily: '"Press Start 2P", cursive',
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.5)',
      padding: { x: 4, y: 2 }
    }).setOrigin(0.5);
    container.add(nameText);

    if (isLocal) {
      this.localPlayerContainer = container;
      this.sent = { x: player.x, y: player.y };
      this.physics.world.enable(this.localPlayerContainer);
      const body = this.localPlayerContainer.body as Phaser.Physics.Arcade.Body;
      // Only the feet bump into things, so the head can pass in front of a wall
      body.setSize(FIGURE_BODY.width, FIGURE_BODY.height);
      body.setOffset(FIGURE_BODY.offsetX, FIGURE_BODY.offsetY);
      body.setCollideWorldBounds(true);

      // Collide with buildings/walls
      this.physics.add.collider(this.localPlayerContainer, this.walls);

      this.cameras.main.startFollow(this.localPlayerContainer, true, 0.1, 0.1);
    }
  }

  private removePlayer(id: string) {
    const container = this.playerEntities[id];
    if (container) {
      if (container === this.localPlayerContainer) this.localPlayerContainer = undefined;
      container.destroy();
      delete this.playerEntities[id];
    }
    this.figures[id]?.destroy(); // after the container, which still shows its pictures
    delete this.figures[id];
  }

  private showEmote(container: Phaser.GameObjects.Container, emote: string) {
    const emoteText = this.add.text(0, FIGURE_TOP - 28, emote, {
      fontSize: '28px',
      fontFamily: 'sans-serif'
    }).setOrigin(0.5);
    
    container.add(emoteText);
    
    // Make sure emote is always on top
    emoteText.setDepth(10);

    this.tweens.add({
      targets: emoteText,
      y: FIGURE_TOP - 78,
      alpha: 0,
      duration: 2500,
      ease: 'Power2',
      onComplete: () => {
        emoteText.destroy();
      }
    });
  }

  update(time: number) {
    // Walk cycles, and whoever stands lower on the map is drawn in front.
    for (const [id, container] of Object.entries(this.playerEntities)) {
      this.figures[id]?.update(time);
      container.setDepth(container.y);
    }

    if (!this.cursors || !this.localPlayerContainer || !this.localPlayerContainer.body) return;

    const body = this.localPlayerContainer.body as Phaser.Physics.Arcade.Body;
    const speed = 200;

    body.setVelocity(0);

    if (this.cursors.left.isDown) {
      body.setVelocityX(-speed);
    } else if (this.cursors.right.isDown) {
      body.setVelocityX(speed);
    }

    if (this.cursors.up.isDown) {
      body.setVelocityY(-speed);
    } else if (this.cursors.down.isDown) {
      body.setVelocityY(speed);
    }

    // Throttled, and always ends with where the avatar stopped.
    const { x, y } = this.localPlayerContainer;
    if ((x !== this.sent.x || y !== this.sent.y) && time - this.lastSent >= SEND_EVERY_MS
      && this.connection.send({ t: 'move', x, y })) {
      this.sent = { x, y };
      this.lastSent = time;
    }
  }
}
