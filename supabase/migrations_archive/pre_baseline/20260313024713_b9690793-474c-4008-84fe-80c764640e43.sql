
-- Chat groups table
CREATE TABLE public.chat_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_groups ENABLE ROW LEVEL SECURITY;

-- Chat group members
CREATE TABLE public.chat_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);

ALTER TABLE public.chat_group_members ENABLE ROW LEVEL SECURITY;

-- Chat messages
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS: users can see groups they belong to
CREATE POLICY "Members can view their groups"
  ON public.chat_groups FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_group_members WHERE group_id = chat_groups.id AND user_id = auth.uid()));

CREATE POLICY "Authenticated users can create groups"
  ON public.chat_groups FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Members can update their groups"
  ON public.chat_groups FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_group_members WHERE group_id = chat_groups.id AND user_id = auth.uid()));

-- RLS: members table
CREATE POLICY "Members can view group members"
  ON public.chat_group_members FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_group_members AS m WHERE m.group_id = chat_group_members.group_id AND m.user_id = auth.uid()));

CREATE POLICY "Group creators can add members"
  ON public.chat_group_members FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Members can leave groups"
  ON public.chat_group_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- RLS: messages
CREATE POLICY "Members can view group messages"
  ON public.chat_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_group_members WHERE group_id = chat_messages.group_id AND user_id = auth.uid()));

CREATE POLICY "Members can send messages"
  ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.chat_group_members WHERE group_id = chat_messages.group_id AND user_id = auth.uid()));
