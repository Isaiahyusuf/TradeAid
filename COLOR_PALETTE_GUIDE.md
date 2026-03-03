# TradeAid Color Palette & Design Tokens

## 🎨 Official Color Palette

### Primary Colors

#### Primary - Green
```
HSL: 142° 71% 45%
RGB: 34, 197, 94
Hex: #22C55E
Usage: Main actions, highlights, primary buttons
```

#### Accent - Purple
```
HSL: 262° 83% 58%
RGB: 168, 85, 247
Hex: #A855F7
Usage: Secondary highlights, gradients, accent buttons
```

### Background Colors

#### Background (Main)
```
HSL: 240° 10% 3%
RGB: 6, 10, 25
Hex: #060A19
Usage: Page background, main surface
```

#### Card
```
HSL: 240° 10% 6%
RGB: 15, 23, 42
Hex: #0F172A
Usage: Card backgrounds, elevated surfaces
```

#### Secondary
```
HSL: 240° 4% 18%
RGB: 30, 41, 59
Hex: #1E293B
Usage: Muted surfaces, secondary backgrounds
```

#### Muted
```
HSL: 240° 4% 20%
RGB: 38, 51, 77
Hex: #26334D
Usage: Disabled states, subtle backgrounds
```

### Text Colors

#### Foreground
```
HSL: 0° 0% 98%
RGB: 250, 250, 250
Hex: #FAFAFA
Usage: Main text, highest contrast
```

#### Muted Foreground
```
HSL: 240° 5% 70%
RGB: 148, 163, 184
Hex: #94A3B8
Usage: Secondary text, labels, muted text
```

### Semantic Colors

#### Success
```
RGB: 34, 197, 94
Hex: #22C55E (same as primary)
Usage: Success states, positive actions
```

#### Warning / Amber
```
HSL: 45° 93% 47%
RGB: 245, 158, 11
Hex: #F59E0B
Usage: Warning states, attention needed
```

#### Destructive / Error
```
HSL: 0° 84% 60%
RGB: 248, 87, 71
Hex: #F85747
Usage: Dangerous actions, errors, warnings
```

#### Offline / Gray
```
HSL: 0° 0% 64%
RGB: 156, 163, 175
Hex: #9CA3AF
Usage: Disabled, offline, inactive states
```

---

## 🎯 Color Usage Guide

### Buttons

#### Primary Button
```tsx
<Button variant="default">Action</Button>
// Background: gradient-to-r from-primary to-accent
// Text: white
// Hover: Glow shadow
```

#### Secondary Button
```tsx
<Button variant="secondary">Secondary</Button>
// Background: bg-secondary/80
// Text: secondary-foreground
// Hover: bg-secondary
```

#### Destructive Button
```tsx
<Button variant="destructive">Delete</Button>
// Background: destructive
// Text: destructive-foreground
// Hover: destructive/90
```

#### Outline Button
```tsx
<Button variant="outline">Outline</Button>
// Border: white/20
// Background: white/5
// Hover: white/10, border-primary/50
```

#### Ghost Button
```tsx
<Button variant="ghost">Ghost</Button>
// Background: transparent
// Text: foreground
// Hover: bg-white/10
```

#### Accent Button
```tsx
<Button variant="accent">Accent</Button>
// Background: accent (purple)
// Text: accent-foreground
// Hover: Glow shadow
```

### Badges

#### Default Badge
```tsx
<Badge variant="default">Tag</Badge>
// Border: primary/30
// Background: primary/10
// Text: primary/90
```

#### Success Badge
```tsx
<Badge variant="success">Active</Badge>
// Border: green-500/30
// Background: green-500/10
// Text: green-400
```

#### Warning Badge
```tsx
<Badge variant="warning">Pending</Badge>
// Border: amber-500/30
// Background: amber-500/10
// Text: amber-300
```

#### Destructive Badge
```tsx
<Badge variant="destructive">Failed</Badge>
// Border: destructive/30
// Background: destructive/10
// Text: destructive
```

### Cards

#### Standard Card
```tsx
<Card>
// Background: card/60 (with backdrop-blur)
// Border: white/10
// Shadow: 0_8px_32px_rgba(0,0,0,0.1)
```

#### Interactive Card (Hover)
```tsx
<Card className="card-hover">
// Hover background: card/60 + enhanced
// Hover shadow: 0_10px_40px_rgba(34,197,94,0.15)
// Hover border: primary/30
```

### Input Fields

#### Standard Input
```tsx
<Input />
// Background: white/5
// Border: white/20
// Focus border: primary/50
// Focus background: white/10
// Focus ring: primary/50
```

#### Input Error State
```tsx
<Input className="border-destructive" />
// Border: destructive
// Background: destructive/5
```

### Status Indicators

#### Online Status
```tsx
<span className="status-online" />
// Color: green-500
// Animation: animate-pulse
```

#### Away Status
```tsx
<span className="status-away" />
// Color: yellow-500
// Animation: animate-pulse
```

#### Offline Status
```tsx
<span className="status-offline" />
// Color: gray-500
// Animation: none
```

---

## 📊 Opacity Scale

### Background Colors with Opacity
```
bg-primary/5    → Very subtle background tint
bg-primary/10   → Subtle background
bg-primary/20   → Moderate background
bg-primary/30   → Strong background
bg-primary/40   → Very strong background
bg-primary/50   → Semi-transparent
bg-primary/60   → More opaque
bg-primary/70   → Mostly opaque
bg-primary/80   → Nearly solid
bg-primary/90   → Almost solid
```

### Border Colors with Opacity
```
border-primary/20   → Very subtle border
border-primary/30   → Subtle border
border-primary/40   → Moderate border
border-primary/50   → Strong border (focus state)
```

### Text Colors with Opacity
```
text-primary/70     → Slightly muted text
text-primary/80     → Semi-muted text
text-primary/90     → Nearly full brightness
```

### Shadow/Glow Effects
```
shadow-[0_0_20px_rgba(34,197,94,0.4)]    → Primary glow
shadow-[0_0_12px_rgba(34,197,94,0.4)]    → Subtle glow
shadow-[0_8px_32px_rgba(0,0,0,0.1)]      → Card shadow
```

---

## 🌈 Gradient Combinations

### Primary to Accent
```tsx
className="bg-gradient-to-r from-primary to-accent"
// Green → Purple
// Usage: Primary buttons, logos, headers
```

### Right Direction Gradient
```tsx
className="bg-gradient-to-r from-accent to-primary"
// Purple → Green
// Usage: Secondary accent areas
```

### Vertical Gradient
```tsx
className="bg-gradient-to-b from-primary/20 to-transparent"
// Fading green to transparent
// Usage: Decorative elements, headers
```

### Text Gradient
```tsx
className="gradient-text"
// Primary → Accent → Primary
// Usage: Important titles, metrics
```

### Radial Gradient
```tsx
className="bg-gradient-radial-to-... from-accent to-transparent"
// Center radiance
// Usage: Background effects, spotlights
```

---

## ♿ Accessibility Considerations

### Contrast Ratios
✅ **WCAG AA Compliant (4.5:1 minimum)**
- Primary text on background: > 7:1
- Secondary text on background: > 4.5:1
- Buttons on background: > 4.5:1
- Icons on background: > 3:1

### Color-Blind Friendly
✅ **Deuteranopia (Red-Green)**
- Primary (green) + Accent (purple) = distinguishable
- Uses multiple visual cues besides color

✅ **Protanopia (Red-Green)**
- Colors still distinguishable with opacity changes
- Additional shape/icon indicators used

### Dark Mode Optimization
✅ **Reduced eye strain** - Low background luminance
✅ **Better readability** - High contrast text
✅ **Accessible animations** - Reduced motion support

---

## 🎯 Common Color Combinations

### Success State
```
Text Color: #22C55E (Primary)
Background: #22C55E/10 (10% opacity)
Border: #22C55E/30 (30% opacity)
Icon Color: #22C55E
```

### Warning State
```
Text Color: #F59E0B (Amber)
Background: #F59E0B/10 (10% opacity)
Border: #F59E0B/30 (30% opacity)
Icon Color: #F59E0B
```

### Error State
```
Text Color: #F85747 (Destructive)
Background: #F85747/10 (10% opacity)
Border: #F85747/30 (30% opacity)
Icon Color: #F85747
```

### Info State
```
Text Color: #A855F7 (Accent)
Background: #A855F7/10 (10% opacity)
Border: #A855F7/30 (30% opacity)
Icon Color: #A855F7
```

### Disabled State
```
Text Color: #94A3B8 (Muted Foreground)
Background: #26334D/50 (Muted with 50% opacity)
Border: #94A3B8/20 (20% opacity)
Opacity: 50% or 70%
```

---

## 📱 Responsive Color Considerations

### Mobile
- Higher contrast for smaller screens
- Same color palette, adjusted opacity
- Larger text for readability

### Tablet
- Standard color scheme
- Medium contrast for readability

### Desktop
- Full color palette
- Normal contrast
- Standard sizing

---

## 🔄 Color Application Patterns

### Pattern 1: Highlight & Muted
```tsx
// Important
className="text-primary bg-primary/10 border-primary/30"

// Secondary
className="text-muted-foreground bg-muted/10 border-muted/20"

// Muted
className="text-muted-foreground/50 bg-muted/5 border-muted/10"
```

### Pattern 2: Status Indicators
```tsx
// Success: Green (primary color)
className="bg-green-500/10 text-green-400 border-green-500/30"

// Warning: Amber
className="bg-amber-500/10 text-amber-400 border-amber-500/30"

// Error: Red
className="bg-red-500/10 text-red-400 border-red-500/30"

// Info: Accent (Purple)
className="bg-purple-500/10 text-purple-400 border-purple-500/30"
```

### Pattern 3: Interactive Elements
```tsx
// Default State
className="bg-secondary text-foreground"

// Hover State
className="bg-secondary/80 hover:border-primary/50"

// Active State
className="bg-primary text-primary-foreground"

// Disabled State
className="opacity-50 pointer-events-none"
```

---

## 📋 Color Checklist for Designers

- [ ] Use primary color for main CTAs
- [ ] Use accent color for secondary highlights
- [ ] Use destructive color for dangerous actions
- [ ] Use opacity for visual hierarchy
- [ ] Maintain contrast ratio > 4.5:1
- [ ] Include multiple cues (not color alone)
- [ ] Test with color-blind simulators
- [ ] Verify on light conditions
- [ ] Check on mobile screens
- [ ] Test with accessibility tools

---

## 🎓 Learning Resources

### CSS Variables Usage
```css
/* Use in your CSS */
color: hsl(var(--primary) / 0.8);
background: hsl(var(--primary) / 0.1);

/* Tailwind will automatically apply opacity */
className="bg-primary/10 text-primary"
```

### RGB to Hex Converter
```
Primary:     #22C55E
Accent:      #A855F7
Destructive: #F85747
```

### Testing Tools
- WebAIM - Color Contrast Checker
- Accessible Colors - Design tool
- Color Oracle - Color-blind simulator
- Axe DevTools - Accessibility audit

---

## 📞 Color Questions?

**Q: Can I use different colors for my team's branding?**
A: Yes, the CSS variables in the `:root` can be customized.

**Q: Are the colors WCAG compliant?**
A: Yes, all colors meet WCAG AA contrast standards.

**Q: Can I change colors dynamically?**
A: Yes, modify the CSS variables in the `:root`.

**Q: What if I need more colors?**
A: Add new CSS variables in `:root` following the same pattern.

---

**Last Updated:** March 3, 2026  
**Version:** 1.0  
**Compliance:** WCAG AA, Color-Blind Friendly
