
class Bee {
    constructor(id) {
        this.id = id;
        
        // Container for bee and speech bubble
        this.container = document.createElement('div');
        this.container.className = 'bee-wrapper';
        this.container.style.position = 'fixed';
        this.container.style.zIndex = '9999';
        this.container.style.pointerEvents = 'none'; // Wrapper shouldn't block events, only image should
        this.container.style.transition = 'transform 0.5s ease-out'; // Smoother transition for container movement if needed
        this.container.style.willChange = 'transform, left, top';

        // Bee Image
        this.element = document.createElement('img');
        this.element.src = '/bee.png';
        this.element.className = 'annoying-bee';
        this.element.style.width = '50px';
        this.element.style.height = 'auto';
        this.element.style.pointerEvents = 'auto'; // Re-enable pointer events for the bee image
        this.element.style.cursor = 'grab';
        this.element.style.userSelect = 'none';
        
        // Speech Bubble
        this.bubble = document.createElement('div');
        this.bubble.innerText = 'Catch me!';
        this.bubble.style.position = 'absolute';
        this.bubble.style.top = '-30px';
        this.bubble.style.left = '50%';
        this.bubble.style.transform = 'translateX(-50%)';
        this.bubble.style.background = 'var(--bg-card, white)';
        this.bubble.style.color = 'var(--text-primary, black)';
        this.bubble.style.padding = '2px 6px';
        this.bubble.style.borderRadius = '4px';
        this.bubble.style.fontSize = '12px';
        this.bubble.style.border = '1px solid var(--border, #ccc)';
        this.bubble.style.whiteSpace = 'nowrap';
        this.bubble.style.opacity = '0'; // Hidden by default
        this.bubble.style.transition = 'opacity 0.2s';
        this.bubble.style.pointerEvents = 'none';

        this.container.appendChild(this.bubble);
        this.container.appendChild(this.element);
        document.body.appendChild(this.container);
        
        // Initial position
        this.x = Math.random() * (window.innerWidth - 50);
        this.y = Math.random() * (window.innerHeight - 50);
        
        // Use Perlin-like noise or sine waves for smoother natural movement
        this.time = Math.random() * 100;
        this.speed = 1.5; // Base speed
        this.noiseOffset = Math.random() * 1000;
        
        // Velocity (used for smooth turns)
        this.vx = 0;
        this.vy = 0;

        // Interaction state
        this.fleeing = false;
        this.fleeTimeout = null;

        // Listeners
        this.element.addEventListener('mouseover', () => this.jumpAway());
        // Also jump if mouse gets too close (proximity check in update loop could be better, but mouseover is simpler)
    }
    
    // Simple 1D noise approximation (super simple)
    noise(t) {
        return Math.sin(t) * Math.sin(t * 2.5) * Math.sin(t * 0.5); 
    }

    jumpAway() {
        if (this.fleeing) return;

        this.fleeing = true;
        this.bubble.style.opacity = '1';
        this.bubble.innerText = "Catch me!";
        
        // Pick a far away target
        const angle = Math.random() * Math.PI * 2;
        const distance = 500 + Math.random() * 300; // Jump 500-800px
        
        let targetX = this.x + Math.cos(angle) * distance;
        let targetY = this.y + Math.sin(angle) * distance;
        
        // Keep within bounds
        targetX = Math.max(50, Math.min(window.innerWidth - 50, targetX));
        targetY = Math.max(50, Math.min(window.innerHeight - 50, targetY));
        
        // Calculate velocity vector for the jump
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        // High speed for jump
        const jumpSpeed = 15; 
        this.vx = (dx / dist) * jumpSpeed;
        this.vy = (dy / dist) * jumpSpeed;

        // Reset fleeing state after a short while to return to normal behavior
        clearTimeout(this.fleeTimeout);
        this.fleeTimeout = setTimeout(() => {
            this.fleeing = false;
            this.bubble.style.opacity = '0';
        }, 800);
    }
    
    update() {
        if (!this.fleeing) {
            // Natural hovering movement using sine waves / noise
            this.time += 0.01;
            
            // Perlin-ish movement
            // Create a flow field effect
            const angle = this.noise(this.time + this.noiseOffset) * Math.PI * 4;
            
            // Desired velocity based on noise
            const targetVx = Math.cos(angle) * this.speed;
            const targetVy = Math.sin(angle) * this.speed;
            
            // Smoothly interpolate current velocity to target velocity (inertia)
            this.vx += (targetVx - this.vx) * 0.05;
            this.vy += (targetVy - this.vy) * 0.05;

            // Occasional random bursts of speed
            if (Math.random() < 0.005) {
                this.vx *= 3;
                this.vy *= 3;
            }
        } else {
            // Fleeing friction
            this.vx *= 0.95;
            this.vy *= 0.95;
        }

        // Apply velocity
        this.x += this.vx;
        this.y += this.vy;
        
        // Soft boundary bounce
        const margin = 50;
        if (this.x < margin) this.vx += 0.2;
        if (this.x > window.innerWidth - margin) this.vx -= 0.2;
        if (this.y < margin) this.vy += 0.2;
        if (this.y > window.innerHeight - margin) this.vy -= 0.2;
        
        this.updatePosition();
    }
    
    updatePosition() {
        this.container.style.left = `${this.x}px`;
        this.container.style.top = `${this.y}px`;
        
        // Calculate rotation angle
        // Add 90 degrees because usually bee images face up or we want side view
        // Let's assume the bee image faces right.
        // If the bee image faces UP by default, we use angle + 90.
        // If right, just angle.
        // Let's assume standard right-facing icon.
        const angleDeg = Math.atan2(this.vy, this.vx) * 180 / Math.PI;
        
        // Smooth rotation could be added but direct is responsive
        this.element.style.transform = `rotate(${angleDeg + 90}deg)`; 
    }
}

function initBees() {
    const beeCount = Math.floor(Math.random() * 3) + 1; // 1 to 3 bees
    const bees = [];
    
    for (let i = 0; i < beeCount; i++) {
        bees.push(new Bee(i));
    }
    
    function animate() {
        bees.forEach(bee => bee.update());
        requestAnimationFrame(animate);
    }
    
    animate();
}

// Start when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBees);
} else {
    initBees();
}
