'use client';

import Link from 'next/link';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Zap,
  Activity,
  Shield,
  Brain,
  ArrowRight,
  Database,
  GitBranch,
  Play,
  Lock,
  RefreshCw,
  Layers,
  Terminal,
  Box,
} from 'lucide-react';

// Floating particles - monochrome
function FloatingParticles() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const particles = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    left: `${(i * 3.3) + Math.random() * 3}%`,
    delay: i * 0.5,
    duration: 20 + (i % 8) * 3,
    size: 1 + (i % 3),
    opacity: 0.1 + (i % 4) * 0.05,
  }));

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-white"
          style={{
            left: p.left,
            bottom: '-10px',
            width: p.size,
            height: p.size,
            opacity: p.opacity,
          }}
          animate={{
            y: [0, -1400],
            opacity: [0, p.opacity, p.opacity, 0],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  );
}

// Monochrome orbs
function MonochromeOrbs() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <motion.div
        className="orb orb-1"
        animate={{
          x: [0, 50, -30, 0],
          y: [0, -60, 40, 0],
          scale: [1, 1.1, 0.95, 1],
        }}
        transition={{ duration: 30, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="orb orb-2"
        animate={{
          x: [0, -60, 40, 0],
          y: [0, 50, -30, 0],
          scale: [1, 0.95, 1.1, 1],
        }}
        transition={{ duration: 35, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="orb orb-3"
        animate={{
          x: [0, 40, -50, 0],
          y: [0, -40, 60, 0],
        }}
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

// Glass card component - monochrome
function GlassCard({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -8, transition: { duration: 0.3 } }}
      className={`glass-mono rounded-3xl p-8 ${className}`}
    >
      {children}
    </motion.div>
  );
}

// Feature card - minimal monochrome
function FeatureCard({
  icon,
  title,
  description,
  delay = 0,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  delay?: number;
}) {
  return (
    <GlassCard delay={delay} className="group cursor-default">
      <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 group-hover:bg-white/10 group-hover:border-white/20 transition-all duration-300">
        <div className="text-white/70 group-hover:text-white transition-colors">{icon}</div>
      </div>
      <h3 className="text-xl font-medium mb-3 text-white">{title}</h3>
      <p className="text-white/50 leading-relaxed">{description}</p>
    </GlassCard>
  );
}

// Stat display - minimal
function StatDisplay({
  value,
  label,
  delay = 0,
}: {
  value: string;
  label: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay }}
      className="text-center"
    >
      <div className="text-5xl md:text-6xl font-light tracking-tight text-white mb-2">
        {value}
      </div>
      <div className="text-sm text-white/40 uppercase tracking-widest">{label}</div>
    </motion.div>
  );
}

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  const heroOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.15], [1, 0.95]);

  return (
    <div
      ref={containerRef}
      className="min-h-screen bg-black text-white overflow-hidden noise-overlay"
    >
      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center">
        <MonochromeOrbs />
        <FloatingParticles />
        <div className="grid-pattern absolute inset-0" />
        <div className="mono-gradient absolute inset-0" />

        <motion.div
          style={{ opacity: heroOpacity, scale: heroScale }}
          className="container mx-auto px-6 relative z-10"
        >
          <div className="flex flex-col items-center text-center max-w-5xl mx-auto">
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="mb-8"
            >
              <div className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full glass-mono-subtle text-white/60 text-sm">
                <Database className="w-4 h-4" />
                <span>Amazon Aurora DSQL</span>
                <span className="w-1 h-1 rounded-full bg-white/40" />
                <span>OCC Testing</span>
              </div>
            </motion.div>

            {/* Main heading */}
            <motion.h1
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="text-6xl md:text-8xl lg:text-9xl font-extralight tracking-tight mb-8 leading-[0.9]"
            >
              <span className="text-gradient-silver">Zero-Lock</span>
              <br />
              <span className="text-white/90">Studio</span>
            </motion.h1>

            {/* Subtitle */}
            <motion.p
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="text-xl md:text-2xl text-white/40 max-w-2xl mb-12 font-light leading-relaxed"
            >
              Chaos engineering playground for distributed transactions.
              <br />
              <span className="text-white/60">Test before production breaks.</span>
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="flex flex-col sm:flex-row gap-4"
            >
              <Link href="/playground">
                <Button
                  size="lg"
                  className="gap-3 bg-white text-black hover:bg-white/90 text-base px-8 py-6 rounded-2xl font-medium transition-all duration-300 hover:scale-105"
                >
                  <Play className="h-5 w-5" />
                  Open Playground
                </Button>
              </Link>
              <Button
                variant="outline"
                size="lg"
                className="gap-3 border-white/20 bg-transparent hover:bg-white/5 text-white/70 hover:text-white text-base px-8 py-6 rounded-2xl font-medium"
              >
                <Terminal className="h-5 w-5" />
                View Documentation
              </Button>
            </motion.div>

            {/* Tech pills */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.5 }}
              className="flex flex-wrap justify-center gap-3 mt-16"
            >
              {[
                { icon: <Layers className="h-4 w-4" />, label: 'Next.js 15' },
                { icon: <Brain className="h-4 w-4" />, label: 'AI Assistant' },
                { icon: <GitBranch className="h-4 w-4" />, label: 'Visual Builder' },
                { icon: <Activity className="h-4 w-4" />, label: 'Real-time Telemetry' },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + i * 0.1 }}
                  className="flex items-center gap-2 px-4 py-2 rounded-full glass-mono-subtle text-white/50 text-sm hover:text-white/70 transition-colors"
                >
                  {item.icon}
                  <span>{item.label}</span>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </motion.div>

        {/* Scroll hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          className="absolute bottom-12 left-1/2 -translate-x-1/2"
        >
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="w-5 h-8 rounded-full border border-white/20 flex items-start justify-center p-1.5"
          >
            <div className="w-1 h-2 rounded-full bg-white/40" />
          </motion.div>
        </motion.div>
      </section>

      {/* Stats Section */}
      <section className="py-32 relative">
        <div className="container mx-auto px-6">
          <GlassCard className="p-12 md:p-16">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-12">
              <StatDisplay value="40001" label="Conflict Detection" delay={0} />
              <StatDisplay value="100%" label="Retry Coverage" delay={0.1} />
              <StatDisplay value="<50ms" label="P95 Latency" delay={0.2} />
              <StatDisplay value="5x" label="Debug Speed" delay={0.3} />
            </div>
          </GlassCard>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-32 relative">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center mb-20"
          >
            <h2 className="text-4xl md:text-6xl font-extralight mb-6">
              <span className="text-white/90">Built for</span>
              <br />
              <span className="text-gradient">Distributed Systems</span>
            </h2>
            <p className="text-white/40 text-lg max-w-xl mx-auto">
              Everything you need to test optimistic concurrency control
            </p>
          </motion.div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <FeatureCard
              icon={<Zap className="h-6 w-6" />}
              title="Chaos Injection"
              description="Inject latency, spawn concurrent transactions, trigger 40001 conflicts on demand"
              delay={0}
            />
            <FeatureCard
              icon={<Activity className="h-6 w-6" />}
              title="Live Telemetry"
              description="Watch conflicts happen in real-time with SSE-powered metrics and visualizations"
              delay={0.1}
            />
            <FeatureCard
              icon={<Shield className="h-6 w-6" />}
              title="Backoff Analysis"
              description="Validate retry patterns and detect retry storms before they crash production"
              delay={0.2}
            />
            <FeatureCard
              icon={<Brain className="h-6 w-6" />}
              title="AI Assistant"
              description="Design transactions via natural language and get smart conflict-prevention tips"
              delay={0.3}
            />
          </div>
        </div>
      </section>

      {/* Visual Builder Preview */}
      <section className="py-32 relative overflow-hidden">
        <div className="container mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -60 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-mono-subtle text-white/50 text-sm mb-8">
                <Box className="w-4 h-4" />
                Visual Transaction Builder
              </div>

              <h2 className="text-4xl md:text-5xl font-extralight mb-8 leading-tight">
                <span className="text-white/90">Design flows.</span>
                <br />
                <span className="text-gradient-subtle">Generate code.</span>
              </h2>

              <p className="text-white/40 text-lg mb-10 leading-relaxed">
                Drag and drop operations, connect transaction flows, and automatically
                generate production-ready code with proper retry logic.
              </p>

              <div className="space-y-5">
                {[
                  'Drag-drop transaction design',
                  'Auto-generate TypeScript & SQL',
                  'Visual conflict flow analysis',
                  'One-click chaos testing',
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className="flex items-center gap-4"
                  >
                    <div className="w-2 h-2 rounded-full bg-white/40" />
                    <span className="text-white/60">{item}</span>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 60 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative"
            >
              <GlassCard className="p-8 overflow-hidden">
                {/* Transaction flow preview */}
                <div className="aspect-[4/3] relative rounded-2xl overflow-hidden bg-black/40 border border-white/5 p-8">
                  {/* Flow nodes */}
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.3, duration: 0.5 }}
                    className="absolute top-6 left-1/2 -translate-x-1/2 px-6 py-2.5 bg-white/10 border border-white/20 rounded-full text-sm font-medium"
                  >
                    BEGIN
                  </motion.div>

                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.4, duration: 0.5 }}
                    className="absolute top-24 left-8 px-4 py-3 bg-white/5 border border-white/10 rounded-xl"
                  >
                    <div className="text-white/60 font-mono text-xs mb-1">SELECT FOR UPDATE</div>
                    <div className="text-white/40 text-xs">accounts</div>
                  </motion.div>

                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.5, duration: 0.5 }}
                    className="absolute top-24 right-8 px-4 py-3 bg-white/5 border border-white/10 rounded-xl"
                  >
                    <div className="text-white/60 font-mono text-xs mb-1">SELECT FOR UPDATE</div>
                    <div className="text-white/40 text-xs">accounts</div>
                  </motion.div>

                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.6, duration: 0.5 }}
                    className="absolute top-48 left-8 px-4 py-3 bg-white/5 border border-white/10 rounded-xl"
                  >
                    <div className="text-white/60 font-mono text-xs mb-1">UPDATE</div>
                    <div className="text-white/40 text-xs">balance - $100</div>
                  </motion.div>

                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.7, duration: 0.5 }}
                    className="absolute top-48 right-8 px-4 py-3 bg-white/5 border border-white/10 rounded-xl"
                  >
                    <div className="text-white/60 font-mono text-xs mb-1">UPDATE</div>
                    <div className="text-white/40 text-xs">balance + $100</div>
                  </motion.div>

                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    whileInView={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.8, duration: 0.5 }}
                    className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-2.5 bg-white/10 border border-white/20 rounded-full text-sm font-medium"
                  >
                    COMMIT
                  </motion.div>

                  {/* Connection lines */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.2 }}>
                    <motion.line
                      x1="50%" y1="15%" x2="25%" y2="30%"
                      stroke="white"
                      strokeWidth="1"
                      initial={{ pathLength: 0 }}
                      whileInView={{ pathLength: 1 }}
                      transition={{ delay: 0.5, duration: 0.4 }}
                    />
                    <motion.line
                      x1="50%" y1="15%" x2="75%" y2="30%"
                      stroke="white"
                      strokeWidth="1"
                      initial={{ pathLength: 0 }}
                      whileInView={{ pathLength: 1 }}
                      transition={{ delay: 0.5, duration: 0.4 }}
                    />
                  </svg>
                </div>
              </GlassCard>

              {/* Subtle glow */}
              <div className="absolute -inset-8 bg-white/5 rounded-[3rem] blur-3xl -z-10" />
            </motion.div>
          </div>
        </div>
      </section>

      {/* DSQL Features */}
      <section className="py-32 relative">
        <div className="container mx-auto px-6">
          <GlassCard className="p-12 md:p-16 overflow-hidden relative">
            {/* Ambient glow */}
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/5 rounded-full blur-[100px] -z-0" />

            <div className="relative z-10">
              <div className="text-center mb-16">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-mono-subtle text-white/50 text-sm mb-6">
                  <Database className="w-4 h-4" />
                  Aurora DSQL
                </div>
                <h2 className="text-4xl md:text-5xl font-extralight">
                  <span className="text-white/90">Optimistic</span>
                  <span className="text-gradient"> Concurrency </span>
                  <span className="text-white/90">Control</span>
                </h2>
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                {[
                  {
                    icon: <Lock className="w-5 h-5" />,
                    title: 'SQLSTATE 40001',
                    desc: 'Aurora DSQL uses commit-time adjudication. Conflicts throw 40001 - we help you handle them gracefully.',
                  },
                  {
                    icon: <GitBranch className="w-5 h-5" />,
                    title: 'Multi-Region Active-Active',
                    desc: 'Test cross-region latency scenarios and validate transaction resilience across regions.',
                  },
                  {
                    icon: <Database className="w-5 h-5" />,
                    title: 'UUID vs Serial Keys',
                    desc: 'Visualize write distribution and see how sequential keys create hotspots.',
                  },
                  {
                    icon: <RefreshCw className="w-5 h-5" />,
                    title: 'Exponential Backoff',
                    desc: 'Validate your retry patterns use proper backoff to prevent retry storms.',
                  },
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className="p-8 rounded-2xl bg-white/[0.02] border border-white/[0.06] hover:bg-white/[0.04] hover:border-white/10 transition-all duration-300"
                  >
                    <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mb-5 text-white/60">
                      {item.icon}
                    </div>
                    <h3 className="font-medium mb-3 text-white text-lg">{item.title}</h3>
                    <p className="text-white/40 leading-relaxed">{item.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </GlassCard>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 relative">
        <div className="container mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-center max-w-3xl mx-auto"
          >
            <h2 className="text-5xl md:text-7xl font-extralight mb-8 leading-tight">
              <span className="text-white/90">Ship with</span>
              <br />
              <span className="text-gradient">Confidence</span>
            </h2>
            <p className="text-white/40 mb-12 text-lg">
              Stop guessing how your code behaves under concurrent load.
              <br />
              Test distributed transactions before production.
            </p>

            <Link href="/playground">
              <Button
                size="lg"
                className="gap-3 bg-white text-black hover:bg-white/90 text-base px-10 py-7 rounded-2xl font-medium transition-all duration-300 hover:scale-105 glow-white"
              >
                <Zap className="h-5 w-5" />
                Start Testing
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-10">
        <div className="container mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white/70" />
            </div>
            <span className="font-medium text-white/80">Zero-Lock Studio</span>
            <span className="text-white/30">|</span>
            <span className="text-white/40 text-sm">H0 Hackathon 2026</span>
          </div>
          <div className="flex gap-8 text-sm text-white/30">
            <span>Aurora DSQL</span>
            <span>Next.js</span>
            <span>Vercel</span>
            <span>OpenAI</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
