// Bulk video operations routes
app.post('/api/v1/videos/batch-delete', authMiddleware, async (req: any, res) => {
  try {
    const user = req.user;
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '请提供要删除的视频 ID 列表' } });
    }
    let deleted = 0;
    for (const id of ids) {
      try { await deleteVideo(id, user.userId); deleted++; } catch {}
    }
    res.json({ data: { deleted } });
  } catch (err: any) {
    console.error('[Batch Delete Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '批量删除失败' } });
  }
});

app.post('/api/v1/videos/concat', authMiddleware, async (req: any, res) => {
  try {
    const user = req.user;
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length < 2) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: '请选择至少 2 个视频' } });
    }
    const allVideos = await getUserVideos(user.userId);
    const selected = allVideos.filter((v: any) => ids.includes(v.id));
    if (selected.length < 2) {
      return res.status(400).json({ error: { code: 'NOT_FOUND', message: '部分视频未找到' } });
    }
    const tmpPaths: string[] = [];
    for (const v of selected) {
      const tmpPath = '/tmp/concat-' + crypto.randomUUID().slice(0, 8) + '.mp4';
      const resp = await fetch(v.video_url);
      if (!resp.ok) return res.status(500).json({ error: { code: 'DOWNLOAD_FAILED', message: '下载失败: ' + v.title } });
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(tmpPath, buf);
      tmpPaths.push(tmpPath);
    }
    const outputFn = 'merged-' + crypto.randomUUID().slice(0, 10) + '.mp4';
    const outputPath = path.join(VIDEO_DIR, outputFn);
    const listPath = outputPath.replace(/\.mp4$/, '-list.txt');
    fs.writeFileSync(listPath, tmpPaths.map(p => "file '" + p + "'").join('\n'));
    await execAsync('ffmpeg -f concat -safe 0 -i "' + listPath + '" -c:v copy -an -y "' + outputPath + '"', { timeout: 120000, cwd: '/tmp' });
    tmpPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
    try { fs.unlinkSync(listPath); } catch {}
    const videoUrl = FRONTEND_URL + '/videos/' + outputFn;
    await saveVideo({
      userId: user.userId,
      title: selected.length + ' 个视频拼接',
      prompt: '合并了: ' + selected.map((v: any) => v.title).join(', '),
      duration: String(selected.reduce((s: number, v: any) => s + parseInt(v.duration || '5'), 0)),
      resolution: selected[0]?.resolution || '720p',
      ratio: selected[0]?.ratio || '16:9',
      inputType: 'concat',
      videoUrl: videoUrl,
      videoPath: outputPath,
      submitId: 'concat-' + crypto.randomUUID().slice(0, 12),
    });
    res.json({ data: { videoUrl: videoUrl, title: selected.length + ' 个视频拼接' } });
  } catch (err: any) {
    console.error('[Concat Error]', err.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '拼接失败: ' + err.message } });
  }
});
