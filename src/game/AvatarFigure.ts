import Phaser from 'phaser';
import { FIGURE_SCALE as S, renderFigureParts } from '../utils/AvatarRenderer';
import type { AvatarConfig, FigurePartName } from '../utils/AvatarRenderer';

type Facing = 'down' | 'up' | 'left' | 'right';

// Where each piece pivots, in the avatar artwork's units, and where the
// container's own position sits in them (just above the feet).
const ORIGIN = { x: 50, y: 128 };
const px = (unitsX: number, unitsY: number) => ({ x: (unitsX - ORIGIN.x) * S, y: (unitsY - ORIGIN.y) * S });
const HEAD = px(50, 69);
const TORSO = px(50, 70);
const ARM_Y = px(0, 77).y;
const LEG_Y = px(0, 110).y;
const FEET_Y = px(0, 142).y;

export const FIGURE_TOP = px(0, -4).y; // above the tallest hat
export const FIGURE_BODY = { width: 26, height: 14, offsetX: -13, offsetY: -4 }; // what bumps into walls: the feet

const STRIDE = 0.075;      // walk cycle radians per pixel travelled
const MOVING_FOR_MS = 150; // still "walking" this long after the last step

// A paper doll that walks. It draws the avatar into a container and, once per
// frame, looks at how far the container moved: that decides which way the head
// faces and how far the arms and legs swing. It needs nothing from the server,
// so remote players, whose container is tweened between updates, walk the same
// way as the local one.
export class AvatarFigure {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private keys: string[] = [];
  private textures = new Map<FigurePartName, string>();
  private loaded = 0;
  private expected = 0;
  private destroyed = false;

  private shadow: Phaser.GameObjects.Ellipse;
  private head: Phaser.GameObjects.Sprite;
  private torso: Phaser.GameObjects.Sprite;
  private arms: Phaser.GameObjects.Sprite[];
  private legs: Phaser.GameObjects.Sprite[];

  private facing: Facing = 'down';
  private shownFacing: Facing | null = null;
  private lastX: number;
  private lastY: number;
  private lastMove = -Infinity;
  private phase = 0;
  private amount = 0; // 0 standing, 1 walking; eased so starts and stops are soft

  // Returns null when the artwork is not loaded; the caller draws a stand-in.
  static create(scene: Phaser.Scene, container: Phaser.GameObjects.Container, id: string, avatar: AvatarConfig): AvatarFigure | null {
    const parts = renderFigureParts(avatar);
    return parts ? new AvatarFigure(scene, container, id, parts) : null;
  }

  private constructor(scene: Phaser.Scene, container: Phaser.GameObjects.Container, id: string, parts: NonNullable<ReturnType<typeof renderFigureParts>>) {
    this.scene = scene;
    this.container = container;
    this.lastX = container.x;
    this.lastY = container.y;

    // The sprites exist at once, hidden, so their place in the container is
    // fixed; pictures are attached as the browser finishes decoding them.
    const sprite = () => scene.add.sprite(0, 0, '__DEFAULT').setVisible(false);
    this.shadow = scene.add.ellipse(0, FEET_Y - 1, 34, 10, 0x000000, 0.22);
    this.head = sprite();
    this.torso = sprite();
    this.arms = [sprite(), sprite()];
    this.legs = [sprite(), sprite()];
    container.add([this.shadow, this.legs[0], this.legs[1], this.torso, this.arms[0], this.arms[1], this.head]);

    for (const [name, art] of Object.entries(parts) as [FigurePartName, (typeof parts)[FigurePartName]][]) {
      const key = `figure_${id}_${name}`;
      this.expected += 1;
      const img = new Image();
      // base64 avoids parsing trouble with raw SVG in a data URI
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(art.svg)));
      img.onload = () => {
        if (this.destroyed) return;
        if (!scene.textures.exists(key)) scene.textures.addImage(key, img);
        this.keys.push(key);
        this.textures.set(name, key);
        this.loaded += 1;
        if (this.loaded === this.expected) this.ready(parts);
      };
      // A piece that cannot be drawn is left out, rather than holding back the whole figure.
      img.onerror = () => {
        if (this.destroyed) return;
        console.warn(`Avatar piece ${name} could not be drawn`);
        this.loaded += 1;
        if (this.loaded === this.expected) this.ready(parts);
      };
    }
  }

  private ready(parts: NonNullable<ReturnType<typeof renderFigureParts>>) {
    const origin = (sprite: Phaser.GameObjects.Sprite, name: FigurePartName) => {
      sprite.setOrigin(parts[name].ox, parts[name].oy);
      this.show(sprite, name);
    };
    origin(this.head, 'headDown');
    origin(this.torso, 'torsoFront');
    for (const arm of this.arms) origin(arm, 'arm');
    for (const leg of this.legs) origin(leg, 'leg');
    this.shownFacing = null; // dress the pieces for the current facing
    this.pose(0);
  }

  // Call every frame with the scene clock.
  update(time: number) {
    if (this.destroyed) return;
    const dx = this.container.x - this.lastX;
    const dy = this.container.y - this.lastY;
    this.lastX = this.container.x;
    this.lastY = this.container.y;

    const distance = Math.hypot(dx, dy);
    if (distance > 0.15) {
      this.lastMove = time;
      this.phase += distance * STRIDE;
      this.turn(dx, dy);
    }
    const walking = time - this.lastMove < MOVING_FOR_MS ? 1 : 0;
    this.amount += (walking - this.amount) * 0.25;
    this.pose(time);
  }

  // Follows the stronger direction, and does not flip-flop on a diagonal.
  private turn(dx: number, dy: number) {
    const sideways = this.facing === 'left' || this.facing === 'right';
    const wantsSideways = sideways ? Math.abs(dx) >= Math.abs(dy) * 0.6 : Math.abs(dx) > Math.abs(dy) * 1.6;
    if (wantsSideways) this.facing = dx < 0 ? 'left' : 'right';
    else this.facing = dy < 0 ? 'up' : 'down';
  }

  private pose(time: number) {
    if (this.loaded < this.expected) return;
    const facing = this.facing;
    const side = facing === 'left' || facing === 'right';
    if (facing !== this.shownFacing) this.dress(facing, side);

    const swing = Math.sin(this.phase) * this.amount;
    const lift = Math.abs(Math.sin(this.phase)) * this.amount;
    const breath = Math.sin(time / 450) * (1 - this.amount);
    const bob = -lift * 2.5 + breath * 0.8;

    this.head.y = HEAD.y + bob;
    this.head.rotation = side ? 0 : swing * 0.04;
    this.torso.y = TORSO.y + bob;
    this.shadow.setScale(1 - lift * 0.12, 1);

    if (side) {
      // Seen from the side the limbs swing back and forth like pendulums.
      this.legs[0].rotation = swing * 0.65;
      this.legs[1].rotation = -swing * 0.65;
      this.arms[0].rotation = -swing * 0.7;
      this.arms[1].rotation = swing * 0.7;
      for (const leg of this.legs) leg.y = LEG_Y;
      for (const arm of this.arms) arm.y = ARM_Y + bob;
    } else {
      // Coming or going they cannot swing toward us: the feet lift and the hands dip.
      this.legs[0].y = LEG_Y - Math.max(0, swing) * 3.5;
      this.legs[1].y = LEG_Y - Math.max(0, -swing) * 3.5;
      this.arms[0].y = ARM_Y + bob + swing * 2;
      this.arms[1].y = ARM_Y + bob - swing * 2;
      this.arms[0].rotation = -swing * 0.18;
      this.arms[1].rotation = swing * 0.18;
      for (const leg of this.legs) leg.rotation = 0;
    }
  }

  // Facing changes which pictures show and where the limbs hang.
  private dress(facing: Facing, side: boolean) {
    this.shownFacing = facing;
    this.show(this.head, facing === 'up' ? 'headUp' : facing === 'left' ? 'headLeft' : facing === 'right' ? 'headRight' : 'headDown');
    this.show(this.torso, facing === 'up' ? 'torsoBack' : 'torsoFront');
    this.torso.setScale(side ? 0.8 : 1, 1);

    const armX = side ? 0 : 25 * S;
    const legX = side ? 1.5 : 9 * S;
    this.arms[0].x = -armX; this.arms[1].x = armX;
    this.legs[0].x = -legX; this.legs[1].x = legX;
    this.legs[0].rotation = this.legs[1].rotation = 0;

    // Side on, one arm is behind the body and one in front of it.
    const order = side
      ? [this.shadow, this.arms[0], this.legs[0], this.legs[1], this.torso, this.arms[1], this.head]
      : [this.shadow, this.legs[0], this.legs[1], this.torso, this.arms[0], this.arms[1], this.head];
    order.forEach((part, index) => this.container.moveTo(part, index));
  }

  // A piece whose picture did not load stays hidden.
  private show(sprite: Phaser.GameObjects.Sprite, name: FigurePartName) {
    const key = this.textures.get(name);
    if (key) sprite.setTexture(key).setVisible(true);
    else sprite.setVisible(false);
  }

  destroy() {
    this.destroyed = true;
    for (const key of this.keys) this.scene.textures.remove(key);
    this.keys = [];
  }
}
