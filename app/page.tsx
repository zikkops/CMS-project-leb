import Navbar from './components/layout/Navbar'
import Hero from './components/home/Hero'
import About from './components/home/About'
import EventsPreview from './components/home/EventsPreview'
import ShopPreview from './components/home/ShopPreview'
import MenuPreview from './components/home/MenuPreview'
import Branches from './components/home/Branches'
import Footer from './components/layout/Footer'
import Reveal from './components/Reveal'

export default function HomePage() {
  return (
    <main>
      <Navbar />
      <Hero />
      <Reveal><About /></Reveal>
      <div id="events-section"><Reveal><EventsPreview /></Reveal></div>
      <div id="shop-section"><Reveal><ShopPreview /></Reveal></div>
      <div id="menu-section"><Reveal><MenuPreview /></Reveal></div>
      <div id="branches-section"><Reveal><Branches /></Reveal></div>
      <Footer />
    </main>
  )
}