<script>
  import { fetchJson, normalizeSourceParam } from './lib/source.js'

  let sourceInput = ''
  let loading = false
  let error = ''
  let data = null

  async function load() {
    error = ''
    data = null
    const url = normalizeSourceParam(sourceInput)
    if (!url) return
    loading = true
    try {
      data = await fetchJson(url)
    } catch (e) {
      error = e?.message || String(e)
    } finally {
      loading = false
    }
  }
</script>

<main style="max-width: 900px; margin: 24px auto; padding: 0 16px; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;">
  <h1>Media Manager (Svelte rewrite)</h1>
  <p>Early scaffold. Loads a source JSON and renders categories/entries.</p>

  <div style="display:flex; gap: 8px; align-items:center;">
    <input style="flex:1; padding:8px 10px;" placeholder="Source URL or relative id/path (e.g. Anime/ConditionLove or Sources/Files/Anime/ConditionLove.json)"
      bind:value={sourceInput} on:keydown={(e)=> e.key==='Enter' && load()} />
    <button on:click={load} disabled={loading} style="padding:8px 12px;">{loading ? 'Loading…' : 'Load'}</button>
  </div>

  {#if error}
    <pre style="margin-top: 12px; padding: 12px; background:#2b1b1b; color:#ffd0d0; border-radius: 8px; white-space: pre-wrap;">{error}</pre>
  {/if}

  {#if data}
    <h2 style="margin-top: 20px;">{data.title}</h2>
    {#if data.Image && data.Image !== 'N/A'}
      <img alt="poster" src={data.Image} style="height: 180px; border-radius: 10px; margin: 8px 0;" />
    {/if}

    {#if Array.isArray(data.categories)}
      {#each data.categories as cat, i}
        <section style="margin: 16px 0; padding: 12px; border: 1px solid #333; border-radius: 10px;">
          <h3 style="margin: 0 0 8px;">{cat.category || `Category ${i+1}`}</h3>
          <ol>
            {#each (cat.episodes || []) as ep, j}
              <li>
                {ep.title || `Episode ${j+1}`}
                {#if ep.src}
                  <code style="opacity:.7; margin-left: 6px;">{ep.src}</code>
                {/if}
              </li>
            {/each}
          </ol>
        </section>
      {/each}
    {:else}
      <p>No categories found.</p>
    {/if}
  {/if}
</main>
