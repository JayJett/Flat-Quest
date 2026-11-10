import {
  Armchair,
  Bath,
  BedDouble,
  BedSingle,
  Bike,
  BookOpen,
  Camera,
  Cat,
  Coffee,
  CookingPot,
  Crown,
  Dog,
  DoorOpen,
  Flower2,
  Gamepad2,
  Ghost,
  Headphones,
  Heart,
  House,
  Lamp,
  Leaf,
  Lightbulb,
  Moon,
  Mountain,
  Music,
  Package,
  Palette,
  Pizza,
  Plane,
  Rocket,
  ShowerHead,
  Sofa,
  Sparkles,
  Sprout,
  Star,
  Sun,
  Trees,
  Tv,
  UtensilsCrossed,
  WashingMachine,
  Waves,
  Wrench,
  Zap,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react'
import { createElement } from 'react'

/** Icons that can represent a room. Stored in the DB by key. */
export const ROOM_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  sofa: { icon: Sofa, label: 'Sofa' },
  armchair: { icon: Armchair, label: 'Armchair' },
  tv: { icon: Tv, label: 'TV' },
  'cooking-pot': { icon: CookingPot, label: 'Kitchen' },
  'utensils-crossed': { icon: UtensilsCrossed, label: 'Dining' },
  coffee: { icon: Coffee, label: 'Coffee' },
  bath: { icon: Bath, label: 'Bath' },
  'shower-head': { icon: ShowerHead, label: 'Shower' },
  'washing-machine': { icon: WashingMachine, label: 'Laundry' },
  'bed-double': { icon: BedDouble, label: 'Double bed' },
  'bed-single': { icon: BedSingle, label: 'Single bed' },
  lamp: { icon: Lamp, label: 'Lamp' },
  'door-open': { icon: DoorOpen, label: 'Entry' },
  trees: { icon: Trees, label: 'Outdoor' },
  sprout: { icon: Sprout, label: 'Plants' },
  wrench: { icon: Wrench, label: 'Tools' },
  package: { icon: Package, label: 'Storage' },
  lightbulb: { icon: Lightbulb, label: 'Lighting' },
  house: { icon: House, label: 'House' },
}

/** Curated personal icons for profiles. Small on purpose. */
export const PROFILE_ICONS: Record<string, { icon: LucideIcon; label: string; tags: string }> = {
  sparkles: { icon: Sparkles, label: 'Sparkles', tags: 'magic shine' },
  heart: { icon: Heart, label: 'Heart', tags: 'love' },
  star: { icon: Star, label: 'Star', tags: 'favourite' },
  sun: { icon: Sun, label: 'Sun', tags: 'summer bright morning' },
  moon: { icon: Moon, label: 'Moon', tags: 'night owl' },
  zap: { icon: Zap, label: 'Lightning', tags: 'energy fast' },
  coffee: { icon: Coffee, label: 'Coffee', tags: 'drink cafe' },
  pizza: { icon: Pizza, label: 'Pizza', tags: 'food' },
  music: { icon: Music, label: 'Music', tags: 'song band' },
  headphones: { icon: Headphones, label: 'Headphones', tags: 'music podcast' },
  'gamepad-2': { icon: Gamepad2, label: 'Games', tags: 'gaming controller' },
  'book-open': { icon: BookOpen, label: 'Books', tags: 'reading study' },
  camera: { icon: Camera, label: 'Camera', tags: 'photo' },
  palette: { icon: Palette, label: 'Art', tags: 'paint design' },
  'flower-2': { icon: Flower2, label: 'Flower', tags: 'garden plant' },
  leaf: { icon: Leaf, label: 'Leaf', tags: 'nature plant' },
  mountain: { icon: Mountain, label: 'Mountain', tags: 'hiking tramping outdoors' },
  waves: { icon: Waves, label: 'Waves', tags: 'beach surf sea swim' },
  bike: { icon: Bike, label: 'Bike', tags: 'cycling' },
  plane: { icon: Plane, label: 'Travel', tags: 'plane holiday' },
  rocket: { icon: Rocket, label: 'Rocket', tags: 'space launch' },
  crown: { icon: Crown, label: 'Crown', tags: 'royal king queen' },
  ghost: { icon: Ghost, label: 'Ghost', tags: 'spooky' },
  dog: { icon: Dog, label: 'Dog', tags: 'pet puppy' },
  cat: { icon: Cat, label: 'Cat', tags: 'pet kitten' },
}

export function roomIcon(key: string): LucideIcon {
  return ROOM_ICONS[key]?.icon ?? House
}

export function profileIcon(key: string): LucideIcon {
  return PROFILE_ICONS[key]?.icon ?? Sparkles
}

/** Renders a room icon by key (stable component; avoids creating components during render). */
export function RoomIcon({ name, ...props }: LucideProps & { name: string }) {
  return createElement(roomIcon(name), props)
}

/** Renders a profile icon by key. */
export function ProfileIcon({ name, ...props }: LucideProps & { name: string }) {
  return createElement(profileIcon(name), props)
}
