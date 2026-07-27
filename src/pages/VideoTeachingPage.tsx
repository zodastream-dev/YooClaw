import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { Monitor } from 'lucide-react'

const videos = [
  {
    id: '1',
    title: '第1集：初识WorkBuddy',
    desc: '下载安装、建立人设、你开发的第一个网游',
    file: '/api/p/videos/workbuddyS1E1.mp4',
  },
  {
    id: '2',
    title: '第2集：WorkBuddy的基本功能',
    desc: '选择内置AI模型，调用"专家"',
    file: '/api/p/videos/workbuddyS1E2.mp4',
  },
  {
    id: '3',
    title: '第3集：WorkBuddy的"技能"',
    desc: '如何调用"技能"对品牌做一个GEO诊断',
    file: '/api/p/videos/workbuddyS1E3.mp4',
  },
  {
    id: '4',
    title: '第4集：WorkBuddy的"连接器"',
    desc: '使用"连接器"与第三方应用互联互通',
    file: '/api/p/videos/workbuddyS1E4.mp4',
  },
  {
    id: '5',
    title: '第5集：用WorkBuddy搭建情报收集和分析网站',
    desc: '搭建网站框架，使用模拟数据',
    file: '/api/p/videos/workbuddyS1E5.mp4',
  },
  {
    id: '6',
    title: '第6集：优化情报网站的数据源',
    desc: '使用特定"技能"，用真实数据源替换模拟数据',
    file: '/api/p/videos/workbuddyS1E6.mp4',
  },
  {
    id: '7',
    title: '第7集：完成情报网站的任务',
    desc: '如何申请第三方应用的接口和api key来优化数据源',
    file: '/api/p/videos/workbuddyS1E7.mp4',
  },
]

export function VideoTeachingPage() {
  return (
    <div className="h-full flex overflow-hidden bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto w-full px-6 py-8">
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-purple-500/20">
                  <Monitor size={20} className="text-white" />
                </div>
                <h1 className="text-2xl font-bold text-foreground">WorkBuddy 视频教学</h1>
              </div>
              <p className="text-muted-foreground text-sm ml-[52px]">
                通过系列视频课程，快速掌握 WorkBuddy 的各项功能
              </p>
            </div>

            {/* Video Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {videos.map((v) => (
                <div
                  key={v.id}
                  className="group relative rounded-xl border border-border bg-card overflow-hidden hover:shadow-xl hover:shadow-purple-500/5 transition-all duration-300"
                >
                  {/* Video Player */}
                  <div className="relative bg-black aspect-video">
                    <video
                      controls
                      preload="metadata"
                      className="w-full h-full object-contain"
                      src={v.file}
                    />
                  </div>

                  {/* Video Info */}
                  <div className="p-4">
                    <h3 className="text-[15px] font-semibold text-foreground mb-1">{v.title}</h3>
                    <p className="text-xs text-muted-foreground mb-3">{v.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
