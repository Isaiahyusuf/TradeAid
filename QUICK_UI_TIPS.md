# Quick Tips for Modern UI Development

## 🚀 Essential Quick References

### Common Component Patterns

#### Modern Card with Hover
```tsx
<Card className="card-hover">
  <CardHeader>
    <CardTitle>Title</CardTitle>
  </CardHeader>
  <CardContent>Content goes here</CardContent>
</Card>
```

#### Modern Button Group
```tsx
<div className="flex gap-3">
  <Button variant="default">Primary Action</Button>
  <Button variant="secondary">Secondary</Button>
  <Button variant="ghost">Cancel</Button>
</div>
```

#### Status Badge Row
```tsx
<div className="flex gap-2 flex-wrap">
  <Badge variant="success">Active</Badge>
  <Badge variant="warning">Pending</Badge>
  <Badge variant="destructive">Failed</Badge>
</div>
```

#### Modern Form Section
```tsx
<div className="space-y-4">
  <div className="space-y-2">
    <Label htmlFor="input">Label</Label>
    <Input id="input" placeholder="Enter value..." />
  </div>
  <Button type="submit" className="w-full">Submit</Button>
</div>
```

#### Data Display Card
```tsx
<Card className="card-hover">
  <CardHeader className="pb-3">
    <div className="flex justify-between items-center">
      <CardTitle>Metric</CardTitle>
      <Badge variant="secondary">24h</Badge>
    </div>
  </CardHeader>
  <CardContent>
    <div className="space-y-2">
      <div className="text-3xl font-bold gradient-text">$1,234.56</div>
      <Progress value={65} className="h-2" />
      <p className="text-sm text-muted-foreground">+15% from last week</p>
    </div>
  </CardContent>
</Card>
```

---

## 🎨 Color Tokens Quick Reference

### Primary Colors
- **Primary**: `#22c55e` (Green) - Main actions, highlights
- **Accent**: `#a855f7` (Purple) - Secondary highlights
- **Destructive**: `#f85747` (Red) - Dangerous actions

### Backgrounds
- **Background**: `rgb(6, 10, 25)` - Main background
- **Card**: `rgb(15, 23, 42)` - Card backgrounds
- **Muted**: `rgb(30, 41, 59)` - Muted sections

### Opacity Scale
- **Full Opacity**: `1.0` - Solid elements
- **High Opacity**: `0.9-0.7` - Primary elements
- **Medium Opacity**: `0.5` - Secondary elements
- **Low Opacity**: `0.2-0.1` - Backgrounds, borders
- **Minimal Opacity**: `0.05` - Subtle effects

### Usage Examples
```tsx
// Light background with border
className="bg-white/5 border border-white/10"

// Semi-transparent gradient
className="bg-primary/20"

// Colored text with transparency
className="text-primary/80"

// Hover effects
className="hover:bg-white/10 hover:border-primary/30"
```

---

## ⚡ Performance Tips

### Animation Optimization
```tsx
// Good: Use built-in utilities
<div className="animate-fade-in-up">Content</div>

// Good: Limit animation duration for UI feedback
className="transition-smooth" // 300ms default

// Avoid: Heavy animations on many elements
// Avoid: Animations longer than 500ms for UI

// Mobile optimization
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; }
}
```

### Rendering Optimization
```tsx
// Good: Use React.memo for expensive components
const Card = React.memo(CardComponent);

// Good: Lazy load images and heavy content
<img loading="lazy" />

// Avoid: Re-renders on animation frames
// Use Framer Motion for complex animations
```

### CSS Optimization
```tsx
// Good: Use Tailwind classes (single class)
className="glass-effect"

// Avoid: Multiple redundant classes
className="backdrop-blur-xl bg-card border border-white/10"

// Good: Use max-w utilities
className="max-w-md mx-auto"

// Avoid: Manual media queries in className
```

---

## 🎯 Spacing Scale Reference

### Consistent Spacing
```tsx
// Padding
p-4  = 1rem     // Default button padding
p-6  = 1.5rem   // Card padding
p-8  = 2rem     // Large sections

// Gap
gap-2 = 0.5rem  // Tight spacing
gap-3 = 0.75rem // Default spacing
gap-4 = 1rem    // Comfortable spacing
gap-6 = 1.5rem  // Loose spacing

// Height
h-10 = 2.5rem   // Standard button
h-12 = 3rem     // Large button

// Pattern Examples
// Buttons: px-6 py-2.5
// Input: px-4 py-2.5
// Cards: p-6
// Sections: gap-4 or gap-6
```

---

## 🎭 Modern Effects Library

### Glow Effects
```tsx
// Button glow on hover
className="hover:shadow-[0_0_20px_rgba(34,197,94,0.4)]"

// Active element glow
className="shadow-[0_0_20px_rgba(34,197,94,0.2)]"

// Progress bar glow
className="shadow-[0_0_12px_rgba(34,197,94,0.4)]"
```

### Glass Effects
```tsx
// Standard glass
className="glass-effect"
// = backdrop-blur-xl bg-card/50 border border-white/10

// Strong glass
className="glass-effect-strong"
// = backdrop-blur-2xl bg-card/70 border border-white/20

// Custom glass
className="backdrop-blur-lg bg-white/5 border border-white/10"
```

### Gradient Effects
```tsx
// Gradient text
className="gradient-text"
// = bg-gradient-to-r from-primary via-accent to-primary

// Gradient button
className="bg-gradient-to-r from-primary to-accent"

// Gradient border (simulate)
className="p-[2px] bg-gradient-to-r from-primary to-accent rounded-lg"
```

---

## 🔧 Common Patterns

### Toggle Button Group
```tsx
<div className="flex gap-1 p-1 bg-white/5 rounded-lg border border-white/10">
  {['option1', 'option2', 'option3'].map(opt => (
    <button
      key={opt}
      className={cn(
        "px-4 py-2 rounded-md transition-all duration-300 font-medium",
        selected === opt
          ? "bg-primary text-primary-foreground shadow-lg"
          : "text-muted-foreground hover:text-foreground"
      )}
      onClick={() => setSelected(opt)}
    >
      {opt}
    </button>
  ))}
</div>
```

### Loading State
```tsx
<Button disabled className="opacity-50 pointer-events-none">
  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
  Loading...
</Button>
```

### Empty State
```tsx
<div className="card-base p-12 text-center">
  <div className="mx-auto w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
    <Icon className="w-8 h-8 text-muted-foreground" />
  </div>
  <h3 className="text-lg font-semibold mb-2">No items found</h3>
  <p className="text-sm text-muted-foreground mb-4">Create one to get started</p>
  <Button variant="default">Create Item</Button>
</div>
```

### Success Toast
```tsx
<div className="card-base p-4 border-l-4 border-green-500/50 bg-green-500/10">
  <div className="flex items-center gap-3">
    <CheckCircle2 className="w-5 h-5 text-green-400" />
    <p className="text-sm font-medium text-green-400">Successfully saved</p>
  </div>
</div>
```

### Error Toast
```tsx
<div className="card-base p-4 border-l-4 border-destructive/50 bg-destructive/10">
  <div className="flex items-center gap-3">
    <AlertCircle className="w-5 h-5 text-destructive" />
    <p className="text-sm font-medium text-destructive">An error occurred</p>
  </div>
</div>
```

---

## 📱 Mobile-First Tips

### Responsive Classes
```tsx
// Good: Mobile-first approach
className="px-4 md:px-8"     // Default mobile, wider on desktop
className="flex-col md:flex-row" // Stack on mobile, row on desktop
className="text-sm md:text-base" // Smaller on mobile, bigger on desktop

// Menu that hides on mobile
<nav className="hidden md:flex">

// Mobile-only menu
<nav className="md:hidden">
```

### Touch-Friendly Sizing
```tsx
// Minimum 48x48px for touch targets
className="min-h-12 min-w-12" // Buttons
className="p-3 md:p-2"       // Padding for touch

// Better spacing on mobile
gap-3 md:gap-2              // More space on mobile
py-4 md:py-2                // More vertical space
```

---

## ✅ Code Quality Checklist

### Before Committing
- [ ] Used component variants consistently
- [ ] Applied glass-effect or modern card styling
- [ ] Added transition-smooth to interactive elements
- [ ] Included focus-visible-ring on interactive elements
- [ ] Used modern button variants
- [ ] Applied proper spacing from scale
- [ ] Tested on mobile breakpoints
- [ ] Verified color contrast
- [ ] Added loading states
- [ ] Tested keyboard navigation

### Review Checklist
- [ ] No hardcoded colors (use theme tokens)
- [ ] No duplicate styles (use utility classes)
- [ ] All interactive elements have hover states
- [ ] All buttons use variant system
- [ ] Consistent spacing throughout
- [ ] Smooth transitions (no jarring changes)
- [ ] Accessible focus states
- [ ] Mobile-responsive
- [ ] Performance optimized

---

## 🆘 Troubleshooting

### Issue: Animations feel janky
**Solution:**
- Reduce animation duration (keep under 400ms)
- Use `will-change` sparingly
- Check for excessive re-renders
- Use Framer Motion for complex animations

### Issue: Colors don't match design
**Solution:**
- Use proper opacity: `/10`, `/20`, `/30`, etc.
- Check if using RGB instead of Tailwind colors
- Verify you're using theme variables, not hardcoded values
- Use `bg-primary/20` not `bg-[#22c55e]/20`

### Issue: Buttons look inconsistent
**Solution:**
- Use Button component with variants
- Don't mix custom classes with Button props
- Use size prop consistently
- Check variant is correct

### Issue: Layout breaks on mobile
**Solution:**
- Use `flex-col md:flex-row` pattern
- Test on actual mobile device (not just DevTools)
- Use responsive padding: `px-4 md:px-8`
- Check gap sizing for mobile

### Issue: Text contrast is poor
**Solution:**
- Verify foreground/background ratio ≥ 4.5:1
- Use higher opacity for text on transparent backgrounds
- Use dedicated color for text, not derived from background
- Test with accessibility tools

---

## 🎓 Learning Resources

### Design Principles
- **Glass-morphism**: Light + blur = modern depth
- **Gradients**: Guide attention to important elements
- **Animations**: Should be subtle and purposeful
- **Spacing**: Creates breathing room and hierarchy
- **Color**: Establishes mood and guides interaction

### Modern Web UI Trends (2024-2025)
- Minimal, clean interfaces
- Smooth, purposeful animations
- Responsive by default
- Dark mode optimized
- Accessible from the start
- Performance-first approach

### Testing Your UI
- Test on multiple browsers (Chrome, Firefox, Safari, Edge)
- Test on mobile devices (iOS, Android)
- Test with screen readers (NVDA, JAWS)
- Test color contrast (WebAIM, Axe)
- Test animations (6x CPU throttling)
- Test keyboard navigation (Tab, Enter, Escape)

---

## 📞 Getting Help

### Code Examples Needed?
1. Check `MODERN_UI_EXAMPLES.md` for before/after
2. Look at component files in `src/components/ui`
3. Check page implementations in `src/pages`

### Design Guidance?
1. Refer to `UI_MODERNIZATION_GUIDE.md`
2. Check the color/spacing scale
3. Review component patterns

### Not Working?
1. Clear node_modules and rebuild
2. Check Tailwind config is correct
3. Verify all imports are correct
4. Check browser console for errors

---

**Pro Tips:**
- 🎯 Keep it simple - fewer classes = faster loading
- 🎨 Consistency matters - use patterns repeatedly
- ⚡ Performance first - lazy load when possible
- ♿ Accessibility always - test with keyboard
- 📱 Mobile first - design for small screens first

---

*Last Updated: March 3, 2026*
*For questions or suggestions, refer to UI_MODERNIZATION_GUIDE.md*
