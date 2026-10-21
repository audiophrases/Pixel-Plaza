import Phaser from 'phaser';
import { AvatarFigure, FIGURE_BODY, FIGURE_TOP } from '../AvatarFigure';
import { ART, MAP_SIZE, SCALE, plazaMap, worldRects, worldZones } from '../../../shared/plazaMap';
import type { PlazaConnection, PlazaEvent, PlazaPlayer } from '../../plaza';
import { NAME_COLOURS } from '../../../shared/levels';

// A nameplate: the flair a student chose, then their name, in the colour they chose.
const plateText = (player: PlazaPlayer) => (player.style?.flair ? `${player.style.flair} ` : '') + player.name;
const plateColour = (player: PlazaPlayer) => NAME_COLOURS[player.style?.colour ?? 0] ?? NAME_COLOURS[0];

// Position updates go out at most this often (the server passes them on in batches as
// often). Remote avatars glide a little longer than that, so an update that arrives late
// on a busy network keeps them walking instead of stopping and starting.
const SEND_EVERY_MS = 150;
const GLIDE_MS = 225;

export default class LobbyScene extends Phaser.Scene {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private connection!: PlazaConnection;

  private playerEntities: { [id: string]: Phaser.GameObjects.Container } = {};
  private figures: { [id: string]: AvatarFigure } = {};
  private nameplates: { [id: string]: Phaser.GameObjects.Text } = {};
  private fog?: Phaser.GameObjects.Image;
  private vision = 0;
  private localPlayerContainer?: Phaser.GameObjects.Container;
  private sent = { x: 0, y: 0 };
  private lastSent = 0;
  private rainUntil = 0;
  private rainGraphic?: Phaser.GameObjects.Graphics;
  private artwork: Record<string, Phaser.GameObjects.Container> = {};
  private magicLabels: Record<string, Phaser.GameObjects.Text> = {};

  constructor() {
    super('LobbyScene');
  }

  init(data: { connection: PlazaConnection }) {
    this.connection = data.connection;
  }

  preload() {
    this.load.image('plaza_bg', plazaMap.image);
  }

  create() {
    this.add.image(0, 0, 'plaza_bg').setOrigin(0, 0).setDisplaySize(MAP_SIZE, MAP_SIZE);
    const mapWidth = MAP_SIZE;
    const mapHeight = MAP_SIZE;

    this.physics.world.setBounds(0, 0, mapWidth, mapHeight);

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      // Phaser blocks the browser's own handling of the keys it is given, space and the arrows
      // included, which would stop the chat box from taking a space or moving its cursor.
      this.input.keyboard.removeCapture('SPACE,SHIFT,UP,DOWN,LEFT,RIGHT');
      // No capture, so typing w, a, s or d in the chat box still works.
      this.wasd = this.input.keyboard.addKeys('W,A,S,D', false) as typeof this.wasd;
    }
    
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);

    // Create a StaticGroup for walls/buildings
    this.walls = this.physics.add.staticGroup();

    for (const [x, y, w, h] of worldRects) {
      const rect = this.add.rectangle(x, y, w, h, 0xff0000, 0).setOrigin(0, 0);
      this.physics.add.existing(rect, true); // true = static body
      this.walls.add(rect);
    }

    this.addWalkBehind();
    this.setVision(this.connection.vision);

    // F2 shows where the walls (red) and named places (blue) are, to tune them against the art.
    const overlay = this.add.graphics().setDepth(100000).setVisible(false);
    overlay.fillStyle(0xff0000, 0.35);
    for (const [x, y, w, h] of worldRects) overlay.fillRect(x, y, w, h);
    overlay.lineStyle(3, 0x3399ff, 1);
    for (const { rect: [x, y, w, h] } of worldZones) overlay.strokeRect(x, y, w, h);
    overlay.lineStyle(3, 0x00ff66, 1);
    for (const piece of plazaMap.walkBehind) {
      if (piece.shape === 'ellipse') overlay.strokeEllipse((piece.rect[0] + piece.rect[2] / 2) * SCALE, (piece.rect[1] + piece.rect[3] / 2) * SCALE, piece.rect[2] * SCALE, piece.rect[3] * SCALE);
      else overlay.strokePoints(piece.points.map(([x, y]) => new Phaser.Math.Vector2(x * SCALE, y * SCALE)), true);
    }
    this.input.keyboard?.on('keydown-F2', () => overlay.setVisible(!overlay.visible));
    // Phaser swallows the click, so the chat box would keep the keyboard: hand it back.
    this.input.on('pointerdown', () => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });

    this.syncRoster();
    const unsubscribe = this.connection.subscribe(event => this.onPlazaEvent(event));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, unsubscribe);
    this.events.once(Phaser.Scenes.Events.DESTROY, unsubscribe);
  }

  // Trees and lamp posts are cut out of the background and drawn again at the depth of
  // the ground they stand on, so a player north of one is hidden behind it.
  private addWalkBehind() {
    const source = this.textures.get('plaza_bg').getSourceImage() as HTMLImageElement;
    const pixels = source.width / ART; // the picture's own pixels per art pixel
    plazaMap.walkBehind.forEach((piece, index) => {
      const points = piece.shape === 'poly' ? piece.points : null;
      const [x, y, w, h] = piece.shape === 'ellipse' ? piece.rect : [
        Math.min(...points!.map(point => point[0])), Math.min(...points!.map(point => point[1])),
        Math.max(...points!.map(point => point[0])) - Math.min(...points!.map(point => point[0])),
        Math.max(...points!.map(point => point[1])) - Math.min(...points!.map(point => point[1]))
      ];
      const key = `foreground_${index}`;
      const canvas = this.textures.createCanvas(key, Math.ceil(w * SCALE), Math.ceil(h * SCALE));
      if (!canvas) return;
      const context = canvas.getContext();
      context.beginPath();
      if (piece.shape === 'ellipse') context.ellipse(canvas.width / 2, canvas.height / 2, canvas.width / 2, canvas.height / 2, 0, 0, Math.PI * 2);
      else piece.points.forEach(([px, py], i) => context[i ? 'lineTo' : 'moveTo']((px - x) * SCALE, (py - y) * SCALE));
      context.closePath();
      context.clip();
      context.drawImage(source, x * pixels, y * pixels, w * pixels, h * pixels, 0, 0, canvas.width, canvas.height);
      canvas.refresh();
      this.add.image(x * SCALE, y * SCALE, key).setOrigin(0, 0).setDepth(piece.sortY * SCALE);
    });
  }

  // Limited vision: the world beyond `radius` pixels of the student is dimmed, and classmates out there are
  // hidden. The dimming is one small picture, scaled up to cover the whole map, that follows the student.
  private setVision(radius: number) {
    this.vision = radius;
    this.fog?.destroy();
    this.fog = undefined;
    if (this.textures.exists('fog')) this.textures.remove('fog');
    if (radius <= 0) return;
    const size = 512; // pixels of the picture; each stands for 8 map pixels
    const scale = 8;
    const canvas = this.textures.createCanvas('fog', size, size);
    if (!canvas) return;
    const context = canvas.getContext();
    context.fillStyle = 'rgba(0, 0, 0, 0.62)';
    context.fillRect(0, 0, size, size);
    // Clear in the middle, fading out to the edge of what the student can see
    context.globalCompositeOperation = 'destination-out';
    const outer = radius / scale;
    const gradient = context.createRadialGradient(size / 2, size / 2, outer * 0.65, size / 2, size / 2, outer);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(size / 2, size / 2, outer, 0, Math.PI * 2);
    context.fill();
    canvas.refresh();
    this.fog = this.add.image(0, 0, 'fog').setScale(scale).setDepth(1_000_000);
  }

  private onPlazaEvent(event: PlazaEvent) {
    if (event.t === 'rain') this.rainUntil = event.until;
    else if (event.t === 'magic' && event.power === 'lightning') {
      const target = this.playerEntities[event.id];
      if (target) {
        const bolt = this.add.graphics().setDepth(999999).lineStyle(6, 0xffee55, 1);
        bolt.beginPath(); bolt.moveTo(target.x + 35, target.y - 330); bolt.lineTo(target.x - 18, target.y - 150); bolt.lineTo(target.x + 24, target.y - 165); bolt.lineTo(target.x, target.y); bolt.strokePath();
        this.tweens.add({ targets: bolt, alpha: 0, duration: 600, onComplete: () => bolt.destroy() });
        this.showEmote(target, '⚡');
      }
    }
    else if (event.t === 'roster') this.syncRoster();
    else if (event.t === 'join') this.addPlayer(event.player);
    else if (event.t === 'leave') this.removePlayer(event.id);
    else if (event.t === 'rename' || event.t === 'style') {
      const player = this.connection.players.get(event.id);
      if (player) this.nameplates[event.id]?.setText(plateText(player)).setColor(plateColour(player));
    }
    else if (event.t === 'vision') this.setVision(event.radius);
    else if (event.t === 'snap' && this.localPlayerContainer?.body) {
      (this.localPlayerContainer.body as Phaser.Physics.Arcade.Body).reset(event.x, event.y);
      this.sent = { x: event.x, y: event.y };
    }
    else if (event.t === 'move' && event.id !== this.connection.selfId) {
      const container = this.playerEntities[event.id];
      if (!container) return;
      this.tweens.killTweensOf(container);
      this.tweens.add({ targets: container, x: event.x, y: event.y, duration: GLIDE_MS });
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

    const pieces = [...container.list];
    const artwork = this.add.container(0, 0);
    container.removeAll();
    artwork.add(pieces);
    container.add(artwork);
    this.artwork[player.id] = artwork;

    // Nameplate, above the tallest hat and drawn over the figure
    const nameText = this.add.text(0, FIGURE_TOP - 12, plateText(player), {
      fontSize: '12px',
      fontFamily: '"Press Start 2P", cursive',
      color: plateColour(player),
      backgroundColor: 'rgba(0,0,0,0.5)',
      padding: { x: 4, y: 2 }
    }).setOrigin(0.5);
    container.add(nameText);
    this.nameplates[player.id] = nameText;

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
    this.magicLabels[id]?.destroy();
    delete this.magicLabels[id];
    delete this.artwork[id];
    delete this.nameplates[id];
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
    const me = this.localPlayerContainer;
    for (const [id, container] of Object.entries(this.playerEntities)) {
      const player = this.connection.players.get(id);
      const down = (player?.downUntil ?? 0) > Date.now();
      const frozen = (player?.frozenUntil ?? 0) > Date.now();
      // Transform the artwork only, keeping the physics feet and nameplate upright.
      this.artwork[id]?.setAngle(down ? 85 : 0);
      if (!this.magicLabels[id]) this.magicLabels[id] = this.add.text(0, FIGURE_TOP - 42, '', { fontSize: '18px', color: '#e5f9ff', backgroundColor: '#173451' }).setOrigin(0.5);
      this.magicLabels[id].setPosition(container.x, container.y + FIGURE_TOP - 42).setDepth(999998).setText(down ? `⚡ Up in ${Math.ceil(((player?.downUntil ?? 0) - Date.now()) / 1000)}s` : frozen ? '❄ Frozen' : '').setVisible(container.visible);
      if (!down && !frozen) this.figures[id]?.update(time);
      container.setDepth(container.y);
      // Classmates fade out toward the edge of what the student sees
      if (this.vision > 0 && me && container !== me) {
        const alpha = Phaser.Math.Clamp((this.vision - Phaser.Math.Distance.Between(me.x, me.y, container.x, container.y)) / (this.vision * 0.3), 0, 1);
        container.setAlpha(alpha).setVisible(alpha > 0);
      } else if (container.alpha !== 1 || !container.visible) container.setAlpha(1).setVisible(true);
    }
    this.rainGraphic ??= this.add.graphics().setScrollFactor(0).setDepth(1000001);
    this.rainGraphic.clear();
    if (this.rainUntil > Date.now()) {
      const { width, height } = this.scale;
      this.rainGraphic.fillStyle(0x355780, 0.12).fillRect(0, 0, width, height).lineStyle(2, 0x9cddff, 0.65);
      for (let i = 0; i < 100; i++) {
        const x = (i * 137 + time * 0.12) % (width + 60) - 30;
        const y = (i * 83 + time * 0.55) % (height + 40) - 20;
        this.rainGraphic.lineBetween(x, y, x - 7, y + 20);
      }
    }
    if (this.fog && me) this.fog.setPosition(me.x, me.y);

    if (!this.cursors || !this.localPlayerContainer || !this.localPlayerContainer.body) return;

    const body = this.localPlayerContainer.body as Phaser.Physics.Arcade.Body;
    const speed = 200;

    body.setVelocity(0);

    // Keys walk only when the chat box is not being typed in.
    const self = this.connection.players.get(this.connection.selfId);
    const immobilized = Math.max(self?.frozenUntil ?? 0, self?.downUntil ?? 0) > Date.now();
    const typing = immobilized || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '');
    const left = !typing && (this.cursors.left.isDown || this.wasd.A.isDown);
    const right = !typing && (this.cursors.right.isDown || this.wasd.D.isDown);
    const up = !typing && (this.cursors.up.isDown || this.wasd.W.isDown);
    const down = !typing && (this.cursors.down.isDown || this.wasd.S.isDown);

    if (left) {
      body.setVelocityX(-speed);
    } else if (right) {
      body.setVelocityX(speed);
    }

    if (up) {
      body.setVelocityY(-speed);
    } else if (down) {
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
